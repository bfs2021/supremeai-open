#!/usr/bin/env python3
"""SupremeAI hardcode-config scanner.

বাংলা: প্রোডাকশন ডোমেইন হার্ডকোড এবং scattered os.getenv() খুঁজে বের করে —
canonical config মডিউলের বাইরে কেউ env পড়লে বা ডোমেইন লিখে ফেললে ব্যর্থ করে।

SCRIPT-INTELLIGENCE v9: auto-discovers targets via scripts/lib/auto_discovery.py — no hardcoded file inventories.
স্ক্যান রুট ও canonical config মডিউল (config_fields/config_validation/settings) লাইভ
ফাইলসিস্টেম থেকে আবিষ্কৃত হয়; রোল না পেলে clear "[discovery] ... skipping" ওয়ার্নিং।

Environment overrides:
  SCAN_ROOT            স্ক্যান রুট পিন করার জন্য (ডিফল্ট: auto-discovered repo root)
  SUPREMEAI_REPO_ROOT  রিপো রুট পিন করার জন্য (scripts/lib/auto_discovery.py)

Exit codes:
  0 = পরিষ্কার (কোনো হার্ডকোড পাওয়া যায়নি)
  1 = হার্ডকোড পাওয়া গেছে
  2 = ত্রুটি (ডিসকভারি খালি — fail-loud)

Usage:
  python hardcode_config_scanner.py            # পূর্ণ স্ক্যান
  python hardcode_config_scanner.py --help     # এই সাহায্য
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/
from lib.auto_discovery import (
    DiscoveryError,
    discover_core_modules,
    discover_files,
    existing_paths,
    get_layout,
    require,
)
from loguru import logger

# ── Rules ──
# 1. No hardcoded production urls
hardcoded_domains = [
    "supremeai-backend-v2.onrender.com",
    "supremeai-backend-v2.onrender.com",
    "supremeai-lac.vercel.app",
    "supremeai-studio.vercel.app"
]

# বাংলা: SCRIPT-INTELLIGENCE v9 — domain-rule-এর জন্য ফাইল-ভিত্তিক অব্যাহতি।
# এই ফাইলগুলোর হোস্ট লিটারেলগুলো FAILSAFE DEFAULT — env var থাকলে env-ই জেতে;
# লিটারেল শুধু last-line-of-defense (লাইভ ইনসিডেন্ট গার্ড, issues #1483/#1484/
# #1455 ও #1468)। Deployment pin নয় — অ্যাপ এই হোস্টগুলোতে call করে না।
# check_hardcoded_deployment_config.py-র EXCEPTION_SPECS-এর একই sanctioned
# শ্রেণি; গার্ড টেস্ট: tests/middleware/test_cors_policy.py.
DOMAIN_RULE_EXEMPT_FILES = {
    "core/middleware/cors_policy.py",
    "gateway/middleware/cors_policy.py",
    "core/config_fields.py",
    "core/core/config_fields.py",
}

# 2. No scattered os.getenv for canonical endpoints
banned_getenv = [
    "FRONTEND_URL",
    "BACKEND_URL",
    "ADMIN_URL",
    "APP_BASE_URL",
    "SUPABASE_URL",
    "DATABASE_URL"
]

# বাংলা: SCRIPT-INTELLIGENCE v9 — canonical config মডিউল রোল-ভিত্তিকভাবে আবিষ্কৃত।
# প্রতিটি রোলের ক্যান্ডিডেট তাদের মধ্যে ক্রমানুসারে চেষ্টা করা হয়; প্রথমটি যা backend/
# (বা স্ক্যান রুটে) বিদ্যমান সেটি জেতে। কোনো পাথ হার্ডকোড করা নেই — রিফ্যাক্টরে
# ফাইল সরে গেলে পরবর্তী ক্যান্ডিডেট ধরা পড়ে, সব না পেলে warn-and-skip হয়।
CANONICAL_CONFIG_ROLE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "config_fields": (
        "core/config_fields.py",
        "config_fields.py",
        "core/config_fields/__init__.py",
    ),
    "config_validation": (
        "core/config_validation.py",
        "config_validation.py",
        "core/config_validation/__init__.py",
    ),
}


def _resolve_scan_root() -> Path:
    """বাংলা: স্ক্যান রুট — SCAN_ROOT env ওভাররাইড, নাহলে auto-discovered রিপো রুট।"""
    env_root = os.getenv("SCAN_ROOT")
    if env_root:
        p = Path(env_root).resolve()
        if not p.is_dir():
            raise DiscoveryError(f"SCAN_ROOT={env_root!r} is not a directory")
        return p
    return get_layout().root


def discover_canonical_config_modules(root: Path) -> tuple[set[Path], list[str]]:
    """বাংলা: os.getenv রুল থেকে অব্যাহতি পাওয়া canonical config মডিউল আবিষ্কার।

    Returns (exempt_paths, warnings) — যে রোল কোথাও না পাওয়া যায় সেটির জন্য
    একটি "[discovery] ... skipping" ওয়ার্নিং যোগ হয়, ক্র্যাশ হয় না।
    """
    exempt: set[Path] = set()
    warnings: list[str] = []

    layout = get_layout()
    backend = layout.backend if (layout.backend and layout.backend.exists()) else root

    for role, candidates in CANONICAL_CONFIG_ROLE_CANDIDATES.items():
        found = existing_paths(backend / c for c in candidates)
        if not found:  # বাংলা: backend-এ না থাকলে স্ক্যান রুট থেকেও চেষ্টা
            found = existing_paths(root / c for c in candidates)
        if found:
            exempt.add(found[0].resolve())
        else:
            msg = f"[discovery] {role} not found — skipping (os.getenv rule will not exempt this role)"
            warnings.append(msg)

    # বাংলা: যেকোনো ডেপথে *settings.py (গ্লোব-ভিত্তিক রোল; পুরোনো 'settings.py'
    # সাবস্ট্রিং অব্যাহতির সমতুল্য, কিন্তু লাইভ ফাইলসিস্টেম থেকে)
    settings_hits = [
        p for p in discover_files(root, ("**/*settings.py",)) if p.suffix == ".py"
    ]
    if settings_hits:
        exempt.update(p.resolve() for p in settings_hits)
    else:
        warnings.append(
            "[discovery] settings.py not found — skipping (os.getenv rule will not exempt this role)"
        )
    return exempt, warnings


def scan_for_hardcoded_configs(root: Path | None = None) -> None:
    if root is None:
        root = _resolve_scan_root()

    layout = get_layout()
    exempt_paths, discovery_warnings = discover_canonical_config_modules(root)

    # CI tooling carve-out (run 36064005746): scripts under scripts/ci/ ARE the
    # environment-reading layer for CI itself (deploy probes, gates, smoke
    # tests). They cannot import backend `core.config` — wrong layer, and the
    # app's settings stack is unavailable in probe contexts — so direct
    # os.getenv/os.environ access there is BY DESIGN. The scattered-os.getenv
    # rule targets the backend application code, not CI tooling.
    _ci_tooling_dir = root / "scripts" / "ci"
    if _ci_tooling_dir.is_dir():
        _ci_files = {p.resolve() for p in _ci_tooling_dir.rglob("*.py")}
        exempt_paths |= _ci_files
        print(
            f"[discovery] CI tooling carve-out: {len(_ci_files)} scripts/ci/**/*.py "
            "exempted from the scattered-os.getenv rule (they are the env-reading layer for CI)"
        )

    ignored_dirs = {
        ".git", ".kilo", "node_modules", "venv", ".venv", "__pycache__",
        "dist", "dist-user", "dist-admin", "build", "archive", "tests",
        ".github", "deploy", "scratch",
    }
    scanned_files: list[Path] = []
    for root_dir, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]
        for f in files:
            p = Path(root_dir) / f
            if "pre_merge_guard.py" in p.name:
                continue
            if any(x in p.name for x in ["test_", ".test."]):
                continue
            if p.name == "hardcode_config_scanner.py":
                continue
            if p.name in ["pnpm-lock.yaml", "package-lock.json", "poetry.lock", "Cargo.lock"]:
                continue
            if p.suffix not in ['.py', '.ts', '.tsx', '.js', '.jsx', '.sh', '.json', '.yml', '.yaml']:
                continue
            scanned_files.append(p)

    # বাংলা: একটাও ফাইল না পেলে নীরবে 'zero-hardcode verified' বলা যাবে না
    require(scanned_files, f"files to scan under {root}")

    core_roles = discover_core_modules(layout.backend) if layout.backend else {}
    print(
        f"[discovery] scanned {len(scanned_files)} files from {root} | "
        f"canonical config modules exempted from os.getenv rule: "
        f"{len(exempt_paths)} ({', '.join(sorted(p.name for p in exempt_paths)) or 'none'}) | "
        f"core roles: {', '.join(sorted(core_roles)) or 'none'}",
        flush=True,
    )
    for w in discovery_warnings:
        logger.warning(w)

    failed = False

    for p in scanned_files:
        try:
            content = p.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            continue

        has_domain = any(domain in content for domain in hardcoded_domains)
        has_banned_getenv = (p.suffix == '.py' and p.resolve() not in exempt_paths and 'os.getenv' in content)
        if not has_domain and not has_banned_getenv:
            continue

        lines = content.splitlines()
        for idx, line in enumerate(lines):
            rel_path = str(p.relative_to(root))
            # Check domains
            for domain in hardcoded_domains:
                if domain in line and 'config_validation' not in p.name and 'roadmap' not in p.name.lower():
                    # We are in checking logic - allow README and Roadmap
                    if p.suffix == '.md':
                        continue
                    # বাংলা: failsafe-default অব্যাহতি (উপরে DOMAIN_RULE_EXEMPT_FILES দেখুন)
                    if rel_path in DOMAIN_RULE_EXEMPT_FILES:
                        continue
                    # Log the exact location
                    logger.error(f"❌ Hardcoded domain '{domain}' found in {rel_path}:{idx+1}")
                    logger.error(f"   > {line.strip()}")
                    failed = True

            # Check os.getenv — বাংলা: অব্যাহতি এখন ডিসকভারি-ভিত্তিক (হার্ডকোড পাথ নয়)
            if p.suffix == '.py' and p.resolve() not in exempt_paths:
                for var in banned_getenv:
                    if re.search(rf'os\.getenv\([\s\'"]*{var}[\s\'"]*', line):
                        logger.error(f"❌ Scattered os.getenv('{var}') found in {p.relative_to(root)}:{idx+1}")
                        logger.error("   > Please import `settings` from core.config instead.")
                        logger.error(f"   > {line.strip()}")
                        failed = True

    if failed:
        logger.error("🚨 Configuration scanner found hardcoded values. Please move these to Infisical/environment variables.")
        sys.exit(1)
    else:
        logger.success("✅ Zero-hardcode configuration verified.")


def _print_usage() -> None:
    print(
        """ব্যবহার: hardcode_config_scanner.py [অপশন]

অপশন:
  --help, -h    এই সাহায্য বার্তা

Environment:
  SCAN_ROOT            স্ক্যান রুট ওভাররাইড (ডিফল্ট: auto-discovered repo root)
  SUPREMEAI_REPO_ROOT  রিপো রুট ওভাররাইড (scripts/lib/auto_discovery.py)

Exit codes:
  0 = পরিষ্কার | 1 = হার্ডকোড পাওয়া গেছে | 2 = ডিসকভারি/ত্রুটি (fail-loud)"""
    )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if any(a in ("--help", "-h") for a in args):
        _print_usage()
        return 0
    unknown = [a for a in args if a.startswith("-")]
    if unknown:
        print(f"❌ অজানা অপশন: {' '.join(unknown)}", file=sys.stderr)
        _print_usage()
        return 2
    try:
        scan_for_hardcoded_configs()
    except DiscoveryError as exc:
        logger.error(f"[discovery] {exc}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
