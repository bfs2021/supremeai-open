"""SupremeAI 2.0 — Portal-ভিত্তিক CORS নীতি (pure functions, কোনো side-effect নেই)।

বাংলা মন্তব্য: User API ও Admin API সম্পূর্ণ আলাদা ব্রাউজার-অরিজিন সেট ট্রাস্ট করে।
এই মডিউলটি সেই নীতিকে একটি জায়গায় কেন্দ্রীভূত করে যাতে:
  1. app_user.py / app_admin.py দুটোই একই সোর্স-অফ-ট্রুথ ব্যবহার করে;
  2. misconfigured env var (যেমন USER_CORS_ORIGINS-এ admin console origin) থাকলেও
     boot-টাইমে সেটি ছেঁকে ফেলা হয় — defense in depth;
  3. টেস্ট ফাইল (tests/test_app_isolation.py) কোনো FastAPI app বুট না করেই
     এবং ENV=production সিমুলেট না করেই নীতিটি যাচাই করতে পারে।

কোনো FastAPI/pydantic import নেই — ইচ্ছাকৃতভাবে dependency-free রাখা হয়েছে।
"""

from __future__ import annotations

import os
from collections.abc import Iterable

from core.config_parsers import parse_origin_list


def _vault_origin_env(env_var: str) -> str:
    """Vault-backed fallback for origin env vars (issues #1483/#1484/#1455).

    বাংলা মন্তব্য: 12-factor ক্রম — প্রসেস env সবসময় আগে; সেখানে না থাকলে
    settings-এর Infisical vault cache থেকে পড়া হয়। Production deploy-গুলোতে
    CORS_ORIGINS/USER_CORS_ORIGINS/ADMIN_CORS_ORIGINS vault-এ আছে কিন্তু
    Render env-এ না থাকলে আগে এখানে খালি দেখাত → সব browser preflight 400।

    Guarded by design: কোনো ব্যর্থতা (import cycle, vault নিচে, tests/CI) চুপচাপ
    "" ফেরত দেয় — এই মডিউলের dependency-free নীতি অটুট থাকে এবং কখনো raise করে না।
    """
    try:
        from core.config import settings

        if settings._is_test_environment():
            return ""
        return settings.get_secret(env_var) or ""
    except Exception:  # pragma: no cover — defensive: boot must never crash here
        return ""


def _load_origins(env_var: str, default: tuple[str, ...]) -> tuple[str, ...]:
    # Roadmap 1.4 (issue #1173): canonical single parser — JSON-array বা
    # comma-separated যেভাবেই operator লিখুক, একই stripped/filtered ফলাফল।
    # core.config_parsers শুধু json/typing import করে, তাই এই মডিউলের
    # "dependency-free (no pydantic)" নীতি অটুট।
    # Issues #1483/#1484/#1455: os.getenv → vault-cache fallback যোগ হলো।
    val = os.getenv(env_var) or _vault_origin_env(env_var)
    if val:
        return tuple(parse_origin_list(val))
    return default


# USER_CORS_ORIGINS is the explicit portal-specific setting. Keep CORS_ORIGINS
# as the backwards-compatible fallback for older deployments.
#
# Issues #1483/#1455 (CRITICAL): the deployed user portal lives at
# https://supremeai-a.web.app (Firebase Hosting) and was rejected by every
# preflight because the historical default here was an empty tuple — if the
# env var was missing/stale on the host, the frontend got zero CORS headers
# (login/chat 100% broken). The known production browser origins are now
# safe code-level defaults; explicit env vars still win when present.
#
# Issue #1491 (LOW): https://supremeai-lac.vercel.app is dead in production
# (verified HTTP 404 on 2026-09-26) — removed from the defaults so we stop
# advertising an origin that can no longer serve the portal. It stays in
# hardcode_config_scanner.py's banned-domain list, so any reintroduction
# gets flagged. Operators who still need it can re-add it via
# USER_CORS_ORIGINS (env values can only ADD origins — see #1518 floor).
DEFAULT_USER_ALLOWED_ORIGINS: tuple[str, ...] = (
    "https://supremeai-a.web.app",  # Firebase Hosting user portal (production)
    "https://supremeai-studio.vercel.app",  # Vercel studio
)

# Issue #1484 (CRITICAL): same story for the admin console — the admin origin
# must stay preflight-able even when ADMIN_CORS_ORIGINS fails to sync to the host.
# Admin-host retirement (2026-10-25, follows PR #1247): the legacy Firebase
# Hosting admin console site is FULLY RETIRED — a stale Cloudflare edge
# redirect used to bounce /admin visitors to it, and keeping it in the CORS
# floor kept advertising a dead origin. The admin console now lives inside
# the Studio SPA at https://supremeai-studio.pages.dev (route /admin) —
# same failsafe-defaults class as before: env vars only ADD origins, they
# can never evict this floor.
DEFAULT_ADMIN_ALLOWED_ORIGINS: tuple[str, ...] = (
    "https://supremeai-studio.pages.dev",  # Studio SPA admin console (route /admin)
)


def _dedupe(origins: Iterable[str]) -> list[str]:
    """অর্ডার রক্ষা করে ডুপ্লিকেট বাদ দেয়।"""
    seen: set[str] = set()
    result: list[str] = []
    for origin in origins:
        cleaned = (origin or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _origins_with_floor(
    defaults: tuple[str, ...], env_var: str, compat_var: str
) -> tuple[str, ...]:
    """Issue #1518 (CRITICAL): the production origins are a MANDATORY floor.

    বাংলা মন্তব্য: #1483/#1484/#1455 ফিক্সে default শুধু তখনই কাজ করত যখন env
    ভ্যারিয়েবল সম্পূর্ণ অনুপস্থিত ছিল। কিন্তু হোস্টে পুরোনো (stale) env বসে থাকলে —
    যেমন Render-এ পুরোনো CORS_ORIGINS যাতে supremeai-a.web.app নেই — সেটি
    ডিফল্টকে সম্পূর্ণ replace করে দিত এবং preflight আবার 400 হতো। নতুন সেম্যান্টিকস:
    production অরিজিনগুলো সবসময় থাকবে; env শুধু নতুন অরিজিন ADD করতে পারে,
    production অরিজিন সরাতে পারে না।
    """
    env_origins = _load_origins(env_var, _load_origins(compat_var, ()))
    return tuple(_dedupe([*defaults, *env_origins]))


USER_ALLOWED_ORIGINS: tuple[str, ...] = _origins_with_floor(
    DEFAULT_USER_ALLOWED_ORIGINS, "USER_CORS_ORIGINS", "CORS_ORIGINS"
)

ADMIN_ALLOWED_ORIGINS: tuple[str, ...] = _origins_with_floor(
    DEFAULT_ADMIN_ALLOWED_ORIGINS, "ADMIN_CORS_ORIGINS", "ADMIN_CORS_ORIGINS"
)

# বাংলা মন্তব্য: সিঙ্গেল ব্যাকএন্ড আর্কিটেকচারের জন্য Denylist ফাঁকা রাখা হলো
USER_ORIGIN_DENYLIST: frozenset[str] = frozenset()

# বাংলা মন্তব্য: সিঙ্গেল ব্যাকএন্ড আর্কিটেকচারের জন্য Denylist ফাঁকা রাখা হলো
ADMIN_ORIGIN_DENYLIST: frozenset[str] = frozenset()


def resolve_user_cors_origins(configured: Iterable[str] | None) -> list[str]:
    """User API-এর চূড়ান্ত allow_origins তালিকা তৈরি করে।

    বাংলা মন্তব্য:
      - wildcard ('*') সবসময় বাদ — credentialed CORS-এর সাথে এটি অবৈধ ও অনিরাপদ;
      - admin surface অরিজিন সবসময় বাদ — আর্কিটেকচারাল আইসোলেশন;
      - কিছুই না থাকলে নিরাপদ ডিফল্ট user অরিজিন সেট করা হয় (boot crash এড়াতে)।
    """
    cleaned = [o for o in _dedupe(configured or []) if o != "*" and o not in ADMIN_ORIGIN_DENYLIST]
    if not cleaned:
        return list(USER_ALLOWED_ORIGINS)
    # Issue #1518: a stale env override can no longer evict the production
    # portal origins — they are a mandatory floor; configured values only ADD.
    for required in USER_ALLOWED_ORIGINS:
        if required not in cleaned:
            cleaned.append(required)
    return cleaned


def resolve_admin_cors_origins(configured: Iterable[str] | None) -> list[str]:
    """Admin API-এর চূড়ান্ত allow_origins তালিকা তৈরি করে।

    বাংলা মন্তব্য:
      - wildcard ('*') সবসময় বাদ;
      - user surface অরিজিন সবসময় বাদ (denylist) — admin/user mixing প্রতিরোধ;
      - admin console origin সবসময় উপস্থিত থাকবে — না থাকলে preflight 403/500 হয়।
    """
    cleaned = [o for o in _dedupe(configured or []) if o != "*" and o not in USER_ORIGIN_DENYLIST]
    for required in ADMIN_ALLOWED_ORIGINS:
        if required not in cleaned:
            cleaned.append(required)
    return cleaned


__all__ = [
    "ADMIN_ALLOWED_ORIGINS",
    "DEFAULT_ADMIN_ALLOWED_ORIGINS",
    "DEFAULT_USER_ALLOWED_ORIGINS",
    "ADMIN_ORIGIN_DENYLIST",
    "USER_ALLOWED_ORIGINS",
    "USER_ORIGIN_DENYLIST",
    "resolve_admin_cors_origins",
    "resolve_user_cors_origins",
]
