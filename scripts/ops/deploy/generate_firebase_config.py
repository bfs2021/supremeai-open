#!/usr/bin/env python3
"""
Deterministic Firebase Configuration Generator.

Reads `firebase.template.json` and deterministically substitutes the backend URLs.
Zero-hardcode policy — fails fast (exit 1) if any of the following hold:
  - the template file is missing
  - BACKEND_URL (or equivalents) is not configured in the environment
  - unresolved `{{...}}` placeholders remain after substitution
  - the substituted output is not valid JSON
  - the SPA fallback rewrite (`**` -> `/index.html`) is missing
  - any rewrite destination is an absolute URL (external-origin proxying is
    NOT supported by Firebase Hosting rewrites — the docs define rewrite
    `destination` as "a local file that must exist"; the 2026-09-18 live
    incident proved an API-rewrite layer like this silently 404s every
    `/api/*` path while looking configured. The SPA calls the API origin
    DIRECTLY with CORS instead — see frontend/src/utils/api.ts)
  - BACKEND_URL (when provided) points at a Firebase Hosting domain
    (`*.web.app` / `*.firebaseapp.com`) — hosting sites are not API origins

Hosting targets (FB-06, issue #587) — status after the admin-host retirement
(2026-10-25, follows PR #1247):
  the template historically defined TWO hosting targets, `user` (site
  `supremeai-a`) and `admin` (site `supremeai-admin`), both shipping the
  identical unified SPA bundle (`"public": "frontend/dist"`). The admin/user
  distinction is runtime route-based inside ONE frontend build — the
  portal-split build architecture (VITE_PORTAL_TYPE, dist-admin/dist-user,
  build:admin/build:user) is OBSOLETE and FORBIDDEN by the CI gate
  `scripts/ci/check_single_frontend.py` (Gate A).

  RETIRED: the `admin` Firebase Hosting site https://supremeai-admin.web.app
  is fully decommissioned. A stale Cloudflare edge redirect used to bounce
  studio.pages.dev/admin visitors to it (fixed in studio/public/_redirects
  with `200!` force rewrites), and the backend CORS floors no longer list it.
  The admin console now lives in the Studio SPA at
  https://supremeai-studio.pages.dev (route /admin). Operators must drop the
  `admin` target from the deploy-time firebase.template.json (root, gitignored)
  and release the Firebase site; the generator only validates rewrite/header
  contracts and does not depend on either target existing.
"""

import json
import os
import re
import sys
from urllib.parse import urlsplit

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# বাংলা: Firebase Hosting rewrite-এর `destination` হলো "a local file that must
# exist" — external-origin proxy (যেমন Render API) সমর্থিত নয়। SPA সরাসরি
# CORS দিয়ে API origin কল করে (frontend/src/utils/api.ts)। তাই একমাত্র বৈধ
# rewrite হলো SPA fallback; absolute-URL destination = মিথ্যা artifact — fail-closed।
SPA_FALLBACK_SOURCE = "**"
SPA_FALLBACK_DESTINATION = "/index.html"


def _origin_of(url: str) -> str:
    """Return lowercase scheme://host[:port] for an absolute URL, else ''."""
    parts = urlsplit(str(url))
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def _validate_hosting(hosting: list[dict]) -> list[str]:
    """Return a list of human-readable errors (empty list == valid).

    বাংলা: চুক্তি — (১) SPA fallback থাকতেই হবে; (২) কোনো rewrite destination
    absolute URL হতে পারবে না (Firebase Hosting external proxy সমর্থন করে না —
    এমন entry থাকা মানে মিথ্যা artifact: configured দেখায় কিন্তু কাজ করে না)।
    """
    errors: list[str] = []
    for site in hosting:
        target = site.get("target", "default")
        rewrites = site.get("rewrites", [])
        if not isinstance(rewrites, list):
            errors.append(f"[{target}] 'rewrites' is not a list")
            continue

        by_source: dict[str, dict] = {}
        for rw in rewrites:
            src = rw.get("source")
            if src and src not in by_source:
                by_source[src] = rw

        # বাংলা: absolute-URL destination নিষিদ্ধ — মিথ্যা artifact (2026-09-18
        # ইনসিডেন্ট: এমন একটি স্তর প্রতিটি /api/* পাথে নীরবে 404 দিচ্ছিল)।
        for rw in rewrites:
            dest = str(rw.get("destination", ""))
            if _origin_of(dest):
                errors.append(
                    f"[{target}] rewrite {rw.get('source')!r} destination is an "
                    f"absolute URL ({dest!r}) — external-origin proxying is not "
                    f"supported by Firebase Hosting rewrites; the SPA must call "
                    f"the API origin directly with CORS (see frontend/src/utils/api.ts)"
                )

        spa = by_source.get(SPA_FALLBACK_SOURCE)
        if spa is None:
            errors.append(
                f"[{target}] missing SPA fallback rewrite {SPA_FALLBACK_SOURCE!r} "
                f"-> {SPA_FALLBACK_DESTINATION!r}"
            )
        elif str(spa.get("destination", "")) != SPA_FALLBACK_DESTINATION:
            errors.append(
                f"[{target}] SPA fallback destination "
                f"{spa.get('destination')!r} != {SPA_FALLBACK_DESTINATION!r}"
            )

        # বাংলা: সিকিউরিটি হেডার চুক্তি যাচাই (FB-02, FB-03)
        # যদি সাইটে headers সংজ্ঞায়িত থাকে, তবে Content-Security-Policy বাধ্যতামূলক
        # এবং অবচিত X-XSS-Protection: 1; mode=block নিষিদ্ধ।
        headers = site.get("headers")
        if headers is not None:
            if not isinstance(headers, list):
                errors.append(f"[{target}] 'headers' is not a list")
            else:
                found_csp = False
                for h_rule in headers:
                    if not isinstance(h_rule, dict):
                        continue
                    h_list = h_rule.get("headers", [])
                    if not isinstance(h_list, list):
                        continue
                    for h in h_list:
                        if not isinstance(h, dict):
                            continue
                        k = str(h.get("key", "")).strip().lower()
                        v = str(h.get("value", "")).strip()
                        if k == "content-security-policy" and v:
                            found_csp = True
                        if k == "x-xss-protection" and v not in ("", "0"):
                            errors.append(
                                f"[{target}] deprecated header X-XSS-Protection: {v!r} detected. "
                                f"OWASP/FB-03 requires removing it or setting value to '0'."
                            )
                if not found_csp:
                    errors.append(
                        f"[{target}] missing Content-Security-Policy header in hosting configuration (FB-02)."
                    )
    return errors


def generate_firebase_config(require_build: bool = False) -> None:
    template_path = "firebase.template.json"
    output_path = "firebase.json"

    print("=== Generating Firebase Configuration ===")

    if require_build:
        dist_index = os.path.join("frontend", "dist", "index.html")
        if not os.path.exists(dist_index) or os.path.getsize(dist_index) == 0:
            print(
                f"❌ ERROR: Frontend build artifact missing or empty at {dist_index}. "
                f"Run `pnpm build` before deploying (FB-04)."
            )
            sys.exit(1)

    if not os.path.exists(template_path):
        print(f"❌ ERROR: Template file {template_path} not found.")
        sys.exit(1)

    # বাংলা: SPA fallback-only টেমপ্লেটে BACKEND_URL-এর কোনো placeholder নেই,
    # তাই এটি আর আবশ্যক নয়। তবে সেট থাকলে এবং মান যদি Hosting ডোমেন হয় —
    # fail-closed (Hosting সাইট কখনো API origin নয়; 2026-09-18 ইনসিডেন্ট)।
    backend_url = (
        os.getenv("BACKEND_URL")
        or os.getenv("VITE_BACKEND_URL")
        or os.getenv("VITE_API_URL")
        or os.getenv("USER_BACKEND_URL")
        or os.getenv("VITE_USER_BACKEND")
    )

    # বাংলা নীতি (False-Assurance doctrine): BACKEND_URL যদি নিজেই একটি Firebase
    # Hosting ডোমেন হয়, তবে /api/** rewrite destination-ও একটি Hosting সাইট —
    # অর্থাৎ API চেইন নিজেকে (self-loop) বা অন্য কোনো Hosting সাইটকে (ফাঁকা সাইট)
    # প্রক্সি কে। ফলাফল: প্রতিটি /api/* রিকোয়েস্ট Firebase-এর HTML "Page Not Found"
    # পেজ ফেরত দেয় (2026-09-18 লাইভ ইনসিডেন্ট — দৈনিক স্মোক এটাই ধরেছিল)।
    # API origin অবশ্যই API সার্ভিস (Render core) হবে, Hosting সাইট নয় —
    # এই ভুল কনফিগ নীরবে ডিপ্লয় হতে পারবে না — fail-closed।
    _backend_host = (urlsplit(backend_url or "").hostname or "").lower()
    if _backend_host.endswith(".web.app") or _backend_host.endswith(".firebaseapp.com"):
        print(
            "❌ ERROR: BACKEND_URL points at a Firebase Hosting domain "
            f"({_backend_host}). The /api/** rewrite destination must be the API "
            "service origin (e.g. the Render core service URL), never a hosting "
            "site — a hosting destination makes every API path return Firebase's "
            "404 page (2026-09-18 live incident)."
        )
        sys.exit(1)

    with open(template_path, "r", encoding="utf-8") as f:
        config_text = f.read()

    # বাংলা: placeholder থাকলে কেবল তখনই substitution — SPA-fallback-only টেমপ্লেটে
    # placeholder নেই, তাই BACKEND_URL ছাড়াও এটি deterministic ভাবে কাজ করে।
    if backend_url:
        config_text = config_text.replace("{{BACKEND_URL}}", backend_url)
        config_text = config_text.replace("{{USER_BACKEND_URL}}", backend_url)
        config_text = config_text.replace("{{ADMIN_BACKEND_URL}}", backend_url)

    # Placeholder detection must match the *pattern* {{NAME}}, not a bare "}}"
    # substring: any JSON doc ending in two closing braces (e.g. {"hosting":
    # {...}}) contains "}}" legitimately. The old substring check was a latent
    # false-positive waiting for such a template shape.
    unresolved = re.search(r"\{\{[^{}]*\}\}", config_text)
    if unresolved:
        print(
            f"❌ ERROR: Unresolved placeholder {unresolved.group(0)!r} remains in "
            f"the generated firebase.json."
        )
        sys.exit(1)

    try:
        config_json = json.loads(config_text)
    except json.JSONDecodeError as e:
        print(f"❌ ERROR: Generated firebase.json is not valid JSON. {e}")
        sys.exit(1)

    # Verify rewrite semantics — fail closed (was WARNING-only before zero-hardcode)
    hosting = config_json.get("hosting", [])
    if isinstance(hosting, dict):
        hosting = [hosting]

    errors = _validate_hosting(hosting)
    if errors:
        print("❌ ERROR: firebase.json hosting rewrite contract violated:")
        for err in errors:
            print(f"   - {err}")
        print(
            "   Fix firebase.template.json: keep only the SPA fallback rewrite "
            "(`**` -> `/index.html`) — the SPA calls the API origin directly "
            "with CORS; external-origin rewrite destinations are unsupported."
        )
        sys.exit(1)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(config_json, f, indent=2)

    print(f"✅ Successfully generated {output_path}")
    if backend_url:
        print(f"   Backend URL present (informational, unused by SPA-fallback-only config): {backend_url}")
    print(
        f"   Hosting contract: SPA fallback validated on {len(hosting)} site(s); "
        f"no external-origin rewrite destinations (unsupported by Firebase Hosting)"
    )
    # FB-06 (issue #587): make the intentionally-shared artifact explicit at
    # deploy time — both targets ship the same unified SPA bundle; admin/user
    # separation is runtime route-based (single-frontend CI gate enforces it).
    if len(hosting) > 1:
        targets = ", ".join(str(site.get("target", "default")) for site in hosting)
        publics = {str(site.get("public", "")) for site in hosting}
        if len(publics) == 1:
            print(
                f"   Hosting targets [{targets}] all ship the SAME public dir "
                f"'{publics.pop()}' — intentional (unified single-frontend SPA; "
                f"admin/user is route-based, see check_single_frontend.py Gate A)"
            )


if __name__ == "__main__":
    require_build_flag = "--require-build" in sys.argv
    generate_firebase_config(require_build=require_build_flag)
