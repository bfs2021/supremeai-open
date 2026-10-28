#!/usr/bin/env python3
"""SupremeAI — Minimal Autonomous Agent Loop (Unified Rules & Roles Dispatcher).

CONTRACT_VERSION = "agent-loop-contract/1"

Traffic-police logic:
1. Always display the 5 Universal Invariant Pillars (Common Rules).
2. If unclaimed issues exist -> Unlimited Solvers allowed: prompt agent with solver mandate & auto-dispatch.
3. If no open issues exist -> Reset/zero cadence timers so scheduled roles can run immediately.
4. Scheduled roles -> Exactly 1 agent at a time per role (active lock / immediate state advance).
5. Problematic/stuck issues -> Agents autonomously decide and handle them.
6. Single-dispatch clean execution: external runner/scheduler drives loop cadence.
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

CONTRACT_VERSION = "agent-loop-contract/1"
UPSTREAM_REPO = "Supremeai-bd/supremeai-open"
REPO_ROOT = Path(__file__).resolve().parents[2]
CADENCE_FILE = REPO_ROOT / "scripts" / "agents" / "agent_cadence.json"
STATE_FILE = REPO_ROOT / "scripts" / "agents" / "agent_cadence_state.json"
ISSUE_LEASE_FILE = REPO_ROOT / "scripts" / "agents" / "dispatched_issues_state.json"
ISSUE_LEASE_SECONDS = 1800.0  # 30-minute autonomous lease (Rule 9 parity without GitHub claim friction)

RULE_FRESHNESS_FILES = (
    "AGENTS.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
)
# বাংলা: AGENT_RULES.md আর নেই — PR #1526 নিজেই ফাইলটি মুছে দিয়েছে (Single Door
# SSOT এখন AGENTS.md)। তালিকায় মুছে-যাওয়া ফাইল রাখলে step_2_rules()
# fresh main-এ সবসময় exit 1 দেয় (missing_local + rev-parse দুই জায়গাতেই fail) —
# নিজের মুছে-ফেলা ফাইলকে পূর্বশর্ত করে রাখা লুপের আত্ম-পরাজয়।

OFFLINE_ENV_VARS = (
    "SUPREMEAI_OFFLINE",
    "AGENT_LOOP_OFFLINE",
    "CI_OFFLINE",
)

# বাংলা: board-exclusion এখন একটাই SSOT। আগে pick_next_issue()-এ এক সেট
# (state:seq-hold, mirror:private আছে, anchor-hub/admin-only নেই) আর main()-এ
# অন্য সেট (anchor-hub, admin-only আছে, state:seq-hold/mirror:private নেই)
# ছিল — একই ধারণার দুই SSOT drift করে এক পথে claimable, অন্য পথে নয়।
EXCLUDED_LABELS = frozenset({
    "status:claimed",
    "status:in-progress",
    "state:seq-hold",
    "blocked-by-upstream",
    "mirror:private",
    "anchor-hub",
    "admin-only",
})

DEFAULT_GROUP = "core"
VALID_TASK_TYPES = frozenset({"FEAT", "FIX", "DOCS", "STYLE", "REFACTOR", "TEST", "CHORE", "PERF", "OPS", "AUDIT", "SCOUT", "IMPLEMENT"})
VALID_PRIORITIES = frozenset({"P0", "P1", "P2", "P3", "P4"})
VALID_ADMIN_GATE_STATUSES = frozenset({"NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"})
VALID_GROUPS = frozenset({"core", "gateway", "studio", "vscode", "browser", "docs", "infra", "marketplace", "federation"})

def build_task_contract(
    task_id: str,
    issue: str | int | None = None,
    task_type: str = "IMPLEMENT",
    group: str = DEFAULT_GROUP,
    priority: str = "P2",
    objective: str = "",
    touching_files: list[str] | None = None,
    forbidden_paths: list[str] | None = None,
    dependencies: list[str] | None = None,
    predecessor: str | int | None = None,
    admin_gate_required: bool = False,
    admin_gate_status: str = "NOT_REQUIRED",
    role_policy: str = "contributor",
    required_evidence: list[str] | None = None,
    verification: list[str] | None = None,
    acceptance: list[str] | None = None,
    stop_conditions: list[str] | None = None,
    output_format: str = "structured",
) -> dict[str, Any]:
    task_type_upper = task_type.upper()
    if task_type_upper not in VALID_TASK_TYPES:
        raise ValueError(f"Invalid task_type: '{task_type}'")
    priority_upper = priority.upper()
    if priority_upper not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority: '{priority}'")
    gate_status_upper = admin_gate_status.upper()
    if gate_status_upper not in VALID_ADMIN_GATE_STATUSES:
        raise ValueError(f"Invalid admin_gate_status: '{admin_gate_status}'")
    if group not in VALID_GROUPS:
        raise ValueError(f"Invalid group: '{group}'")
    # বাংলা: আগের সংস্করণ touching_files/forbidden_paths/admin_gate_status-সহ ১২টি
    # প্যারামিটার ভ্যালিডেট করেও নীরবে ফেলে দিত — চুক্তি নিজের স্কিমাটিই মিথ্যা বলত
    # (admin_gate গভর্নেন্স-ডেটা হারিয়ে যেত)। এখন ভ্যালিডেট-করা প্রতিটি ফিল্ড
    # এমিট হয় (AGENT_LOOP_SPEC.md §2 envelope sections-এর সাথে সামঞ্জস্য)।
    # CI শুধু version==1 ও invalid task_type ValueError দাবি করে — দুটোই অক্ষত।
    return {
        "task_contract": {
            "version": 1,
            "task_id": str(task_id),
            "issue": issue,
            "task_type": task_type_upper,
            "group": group,
            "priority": priority_upper,
            "objective": objective,
            "touching_files": list(touching_files or []),
            "forbidden_paths": list(forbidden_paths or []),
            "dependencies": list(dependencies or []),
            "predecessor": predecessor,
            "admin_gate": {
                "required": bool(admin_gate_required),
                "status": gate_status_upper,
            },
            "role_policy": role_policy,
            "required_evidence": list(required_evidence or []),
            "verification": list(verification or []),
            "acceptance": list(acceptance or []),
            "stop_conditions": list(stop_conditions or []),
            "output_format": output_format,
        }
    }

def label_names(item: dict[str, Any]) -> list[str]:
    labels = item.get("labels")
    if not isinstance(labels, list):
        return []
    return [str(l.get("name", "")).lower() for l in labels if isinstance(l, dict)]

def has_open_p0_blocker(issues: list[dict[str, Any]]) -> bool:
    """Check if there is any open, actionable P0-critical architectural issue.

    বাংলা: P0 Drainage Invariant (Rule 5) কেবল অ্যাকশনেবল P0-তে প্রযোজ্য।
    blocked-by-upstream লেবেলযুক্ত P0 এই লেনের কেউই দাবি করতে পারে না
    (pick_next_issue()-এর EXCLUDED_LABELS-এও আছে) — এমন চিরকাল-খোলা P0
    has_open_p0_blocker()-ও ধরে রাখলে cadence রোল অনির্দিষ্টকালের জন্য
    অবরুদ্ধ হয় (starvation): কেউ সমাধান করতে পারবে না, আবার অন্য সব রুটিন
    কাজও বন্ধ থাকবে। তাই এই লেনে-অ্যাকশনেবল-নয় এমন P0 ব্লকার-গণনা থেকে বাদ;
    status:claimed P0 আগের মতোই ব্লক করবে (অন্য রানার সক্রিয়ভাবে কাজ করছে —
    নিয়ম ৫-এর উদ্দিষ্ট আচরণ)।
    """
    unactionable_in_lane = frozenset({"blocked-by-upstream"})
    for item in issues:
        if not isinstance(item, dict):
            continue
        names = label_names(item)
        if unactionable_in_lane & set(names):
            continue
        if any(name == "p0" or name.startswith("p0-") or name.startswith("p0 ") for name in names):
            return True
    return False

def pick_next_issue(
    exclude: set[str] | list[str] | None = None,
    issues: list[dict[str, Any]] | None = None,
) -> str | None:
    """বাংলা: priority-অনুসারে পরবর্তী claimable issue বাছাই (P0 আগে, তারপর নম্বর)।

    আগের সংস্করণে এই ফাংশনটিই একমাত্র priority-sorter ছিল কিন্তু main() কখনো ডাকতই না
    (dead code) — ফলে লুপ P0 আগে দেবে এই প্রতিশ্রুতি কোডে কখনো কার্যকর হয়নি। এখন
    main() pre-fetched board এখানে পাঠায় (issues=...) — এক সাইকেলে দুবার gh query হয় না।
    """
    if issues is None:
        code, out, _ = run_cmd([
            "gh", "issue", "list",
            "--repo", UPSTREAM_REPO,
            "--state", "open",
            "--limit", "200",
            "--json", "number,title,labels",
        ])
        issues = []
        if code == 0 and out.strip():
            try:
                issues = json.loads(out)
            except Exception:
                pass
    if not issues:
        return None

    lease_store = load_issue_lease_store()
    now_ts = time.time()

    def is_claimable(item: dict[str, Any]) -> bool:
        names = label_names(item)
        if EXCLUDED_LABELS & set(names):
            return False
        # বাংলা: ৩০ মিনিটের স্বয়ংক্রিয় লিজ ট্র্যাকিং — অন্য এজেন্ট যদি ৩০ মিনিটের মধ্যে কাজ শেষ না
        # করে থাকে, তবে এটি নিজে থেকেই রিলিজ হয়ে রি-ক্লেইমযোগ্য হয়ে যাবে।
        num_str = str(item.get("number", ""))
        leased_at = lease_store.get(num_str)
        if leased_at is not None and (now_ts - leased_at) < ISSUE_LEASE_SECONDS:
            return False
        return True

    PRIORITY_MAP = (("p0", 0), ("p1", 1), ("p2", 2), ("p3", 3))

    def priority_key(item: dict[str, Any]) -> tuple[int, int]:
        names = label_names(item)
        tier = 4
        for marker, rank in PRIORITY_MAP:
            if any(name == marker or name.startswith(marker + "-") or name.startswith(marker + " ") for name in names):
                tier = rank
                break
        return (tier, int(item.get("number", 0)))

    candidates = [i for i in issues if isinstance(i, dict) and is_claimable(i)]
    if exclude:
        excluded_set = {str(e) for e in exclude}
        candidates = [i for i in candidates if str(i.get("number")) not in excluded_set]
    sorted_issues = sorted(candidates, key=priority_key)
    if sorted_issues:
        return str(sorted_issues[0].get("number"))
    return None


DEFAULT_CADENCE_HOURS: dict[str, int] = {
    "ecosystem-scout": 12,
    "auditor": 12,
    "human-eye": 24,
    "rules-breaker": 24,
    "platform-guardian": 24,
}

DEFAULT_MERGED_ROLES: dict[str, str] = {
    "federation-auditor": "auditor",
    "task-auditor": "auditor",
    "ci-fixer": "solver",
    "coder": "solver",
}

ROLE_RULES: dict[str, str] = {
    "solver": "Unlimited concurrent solvers allowed. Solve root cause, verify boundary, and submit PR.",
    "auditor": "6 repo codebase-এ যা যা সমস্যা আছে তা পুঙ্খানুপুঙ্খ অডিট ও সমাধান বের করা।",
    "ecosystem-scout": "সারা বিশ্বের যেকোনো জায়গা থেকে SupremeAI-এর জন্য সবচেয়ে লাভজনক ও উপকারী হবে এমন জিনিস ও ইনোভেশন খুঁজে আনা। শুধুমাত্র লাইভ প্রমাণসহ কংক্রিট, বাস্তবায়নযোগ্য ফাইন্ডিং ফাইল করা যাবে; অনুমাননির্ভর/হাইপ টিকেট কঠোরভাবে নিষিদ্ধ; কোড এডিট নয়।",
    "human-eye": "আমাদের কাস্টমার যেন সর্বোত্তম ও শ্রেষ্ঠ এক্সপেরিয়েন্স পায় তার জন্য প্রয়োজনীয় সমস্ত UI/UX ও পারফরম্যান্স নিশ্চিত করা।",
    "rules-breaker": "আমাদের সম্পূর্ণ সিস্টেমের সিকিউরিটি, টেকনিক্যাল ডেট এবং লজিক্যাল গ্যাপের সমস্ত দুর্বলতা খুঁজে বের করে রিপোর্ট করা।",
    "platform-guardian": "প্রজেক্টের সাথে যুক্ত অন্যান্য সমস্ত থার্ড-পার্টি প্ল্যাটফর্ম ও সার্ভিসের সার্বক্ষণিক তদারকি ও নজরদারি নিশ্চিত করা।",
}

ROLE_METADATA: dict[str, dict[str, Any]] = {
    "solver": {
        "deliverable_type": "CODE_PATCH",
        "description": "Code implementation or bugfix with verified tests and clean rebase.",
        "mcp_tools": ["github_workflow_runs", "github_get_failed_logs", "github_read_file", "bridge_submit_patch"],
    },
    "coder": {
        "deliverable_type": "CODE_PATCH",
        "description": "Code implementation or bugfix with verified tests and clean rebase.",
        "mcp_tools": ["github_workflow_runs", "github_get_failed_logs", "github_read_file", "bridge_submit_patch"],
    },
    "ci-fixer": {
        "deliverable_type": "CODE_PATCH",
        "description": "Emergency CI greening: diagnose failure logs, fix root cause, submit patch.",
        "mcp_tools": ["github_workflow_runs", "github_get_failed_logs", "github_read_file", "bridge_submit_patch"],
    },
    "auditor": {
        "deliverable_type": "STRUCTURED_AUDIT_REPORT",
        "description": "Multi-repo compliance, boundary sanitization, and dependency parity report.",
        "mcp_tools": ["github_read_file", "github_repo_tree", "db_schema_inspect", "supabase_schema_inspect"],
    },
    "task-auditor": {
        "deliverable_type": "STRUCTURED_AUDIT_REPORT",
        "description": "Pre-landing compliance verification, secret leak audit, and boundary review.",
        "mcp_tools": ["github_read_file", "github_list_prs", "guardian_evaluate_pr"],
    },
    "federation-auditor": {
        "deliverable_type": "STRUCTURED_AUDIT_REPORT",
        "description": "Satellite repositories sync, head commit parity, and drift audit.",
        "mcp_tools": ["github_read_file", "github_repo_tree", "github_list_prs"],
    },
    "ecosystem-scout": {
        "deliverable_type": "SCOUTING_DOSSIER_AND_ISSUES",
        "description": "Deep radar dissection of external tech; concrete live-proof proposals without code edits.",
        "mcp_tools": ["github_search_repos", "github_repo_info", "github_read_external_file", "github_collect_highlights", "docs_search"],
    },
    "human-eye": {
        "deliverable_type": "UX_AESTHETICS_REPORT",
        "description": "Frontend DevTools audit (console, network, Lighthouse, CSS) and styling specs.",
        "mcp_tools": ["cloudflare_analytics", "cloudflare_worker_status", "system_health", "health_dashboard"],
    },
    "rules-breaker": {
        "deliverable_type": "EXPLOIT_PROOF_AND_P0_ISSUE",
        "description": "Red-team chaos and boundary exploitation proof; P0-critical blocker filing.",
        "mcp_tools": ["github_read_file", "redis_ping", "supabase_health", "status"],
    },
    "platform-guardian": {
        "deliverable_type": "SERVICE_HEALTH_AND_CIRCUIT_STATUS",
        "description": "Third-party platform sentinel, quota freshness, and circuit-breaker telemetry.",
        "mcp_tools": ["render_service_health", "render_list_services", "supabase_health", "redis_stats", "cloudflare_worker_status"],
    },
}

COMMON_RULES = """=== UNIVERSAL INVARIANTS (ALL ROLES MUST FOLLOW) ===
1. Dual-Rebase: Rebase origin/main at work-start AND pre-push (0 behind).
2. Boundary: Zero satellite code in repo root (src/*, service/*, packages/*).
3. Superior Replacement: Discard broken legacy code/tests; never hack new code to appease past errors.
4. Verification: No direct push to protected branches; all PRs require local proof.
5. P0 Drainage & Anti-Stampede: Architectural P0 blockers supersede all routine audits/scout tickets; idempotency check mandatory."""

def log(icon: str, msg: str) -> None:
    try:
        print(f"{icon} {msg}")
    except UnicodeEncodeError:
        print(f"[*] {msg}")

def run_cmd(
    cmd: list[str], cwd: Path | None = None, check: bool = False, timeout: int = 300
) -> tuple[int, str, str]:
    target_cwd = cwd or REPO_ROOT
    try:
        p = subprocess.run(
            cmd,
            cwd=target_cwd,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        stdout = p.stdout.decode("utf-8", errors="replace").strip()
        stderr = p.stderr.decode("utf-8", errors="replace").strip()
        if check and p.returncode != 0:
            raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd)}\n{stderr}")
        return p.returncode, stdout, stderr
    except FileNotFoundError as exc:
        err = f"Binary not found: '{cmd[0] if cmd else 'unknown'}'"
        if check:
            raise RuntimeError(err) from exc
        return 127, "", err
    except subprocess.TimeoutExpired:
        err = f"Command timed out after {timeout}s: {' '.join(cmd)}"
        if check:
            raise RuntimeError(err)
        return 124, "", err
    except Exception as exc:
        err = f"Execution error for {' '.join(cmd)}: {exc}"
        if check:
            raise RuntimeError(err) from exc
        return 1, "", err

def diff_rule_freshness(
    local_shas: dict[str, str | None], remote_shas: dict[str, str | None]
) -> list[str]:
    diverged: list[str] = []
    # Preserve order of RULE_FRESHNESS_FILES first, then any extra keys
    ordered_keys: list[str] = [k for k in RULE_FRESHNESS_FILES if k in local_shas or k in remote_shas]
    for k in sorted(set(local_shas) | set(remote_shas)):
        if k not in ordered_keys:
            ordered_keys.append(k)
    for key in ordered_keys:
        loc = local_shas.get(key)
        rem = remote_shas.get(key)
        if loc != rem:
            diverged.append(key)
    return diverged

def mandatory_invariant_checklist() -> list[dict[str, Any]]:
    return [
        {"id": "zero-admin-budget", "rule": "Work budget <= 0.01%"},
        {"id": "claim-gate", "rule": "Atomic claim before branch (status:claimed)"},
        {"id": "reflection-evidence", "rule": "## Reflection Evidence with - **why:** and - **alternatives_rejected:**"},
        {"id": "p7-cohesive-sizing", "rule": "Cohesive domain slice <= 30 files / <= 200 KB diff"},
        {"id": "boundary-guard", "rule": "Satellite code strictly in domain mirrors"},
        {"id": "stale-base-guard", "rule": "Rebase origin/main at work-start AND pre-push (0 behind)"},
    ]

def _offline_requested(flag: bool) -> bool:
    if flag:
        return True
    return any(
        os.environ.get(var, "").strip().lower() in ("1", "true", "yes", "on")
        for var in OFFLINE_ENV_VARS
    )

def _print_rule_version_and_checklist() -> None:
    pass

def step_2_rules(offline: bool = False, auto_sync: bool = True) -> bool:
    """Step 2: Constitution freshness gate + governing-rules loading (#567)."""
    repo_root = REPO_ROOT
    missing_local = [p for p in RULE_FRESHNESS_FILES if not (repo_root / p).exists()]

    if _offline_requested(offline):
        # বাংলা: অফলাইনে সেলফ-হিল অসম্ভব — আচরণ অপরিবর্তিত (missing মানে fail)।
        if missing_local:
            log("❌", f"[Rules] offline and missing local freshness files: {missing_local}")
            return False
        _print_rule_version_and_checklist()
        return True

    code, _, err = run_cmd(["git", "fetch", "origin", "main"], cwd=repo_root)
    if code != 0:
        return False

    local_shas: dict[str, str | None] = {}
    remote_shas: dict[str, str | None] = {}
    for path in RULE_FRESHNESS_FILES:
        r_code, r_out, _ = run_cmd(
            ["git", "rev-parse", "--verify", "--quiet", f"origin/main:{path}"], cwd=repo_root
        )
        if r_code != 0:
            # বাংলা: ফাইলটি origin/main-এ আর নেই (deleted/renamed upstream)।
            # মুছে-ফেলা ফাইলকে পূর্বশর্ত করে রাখা লুপের আত্ম-পরাজয় — AGENT_RULES.md
            # ঠিক এভাবেই #1526-এ লুপটা মেরেছিল (rev-parse fail মানে exit 1 চিরকাল)।
            # তাই এই রানে গেট থেকে বাদ; fail-closed নয়, honest-skip।
            log("!", f"[Rules] {path} no longer exists on origin/main — deleted upstream; skipping this run.")
            continue
        remote_shas[path] = r_out.strip() or None
        h_code, h_out, h_err = run_cmd(["git", "hash-object", "--", path], cwd=repo_root)
        if h_code != 0:
            # বাংলা: স্থানীয় কপি নেই কিন্তু origin/main-এ আছে —
            # fetch ইমেধেই ব্যর্থ ঘোষণা নিজের সেলফ-হিল-প্রণালীকে প্রতারাধ করত।
            # এখন diverged-sync ব্রাঞ্চের মেকানিসম দিয়ে পুনরুদ্ধার করে hash করা হয়।
            c_code, _, _ = run_cmd(
                ["git", "checkout", "origin/main", "--", path], cwd=repo_root
            )
            if c_code != 0:
                log("❌", f"[Rules] {path} missing locally and self-heal from origin/main failed.")
                return False
            h_code, h_out, h_err = run_cmd(["git", "hash-object", "--", path], cwd=repo_root)
            if h_code != 0:
                return False
        local_shas[path] = h_out.strip() or None

    diverged = diff_rule_freshness(local_shas, remote_shas)

    if diverged and auto_sync:
        for path in diverged:
            c_code, _, _ = run_cmd(
                ["git", "checkout", "origin/main", "--", path], cwd=repo_root
            )
            if c_code != 0:
                return False

    _print_rule_version_and_checklist()
    return True

def pre_push_rebase_guard() -> tuple[bool, int, str]:
    """#514 Pre-Push Rebase Invariant (Anti-Stale-Base Mandate). Fail-closed."""
    fetch_code, _, fetch_err = run_cmd(["git", "fetch", "origin", "main"])
    if fetch_code != 0:
        return False, 0, f"fetch of origin main failed: {fetch_err or 'unknown'}"
    rc, out, err = run_cmd(["git", "rev-list", "--count", "HEAD..origin/main"])
    if rc != 0:
        return False, 0, f"behind-count failed: {err or 'unknown'}"
    try:
        behind = int((out or "0").strip() or "0")
    except ValueError:
        return False, 0, f"unparseable behind-count: {out!r}"
    if behind <= 0:
        return True, 0, "fresh"
    rc, _, err = run_cmd(["git", "rebase", "origin/main"])
    if rc != 0:
        run_cmd(["git", "rebase", "--abort"])
        return False, behind, f"rebase failed; aborted: {err or ''}"
    return True, behind, f"stale ({behind} behind); rebased onto origin/main"

def pre_work_rebase_guard() -> tuple[bool, int, str]:
    """Start-of-Work Rebase Mandate (#161, #514)."""
    return pre_push_rebase_guard()

# বাংলা: পুরনো step-পাইপলাইনের মৃত ক্লাস্টার (step_4_branch, step_6_verify,
# push_branch_to_fork, step_7_record, run_cycle) বাদ দেওয়া হলো। step_6_verify ও
# push_branch_to_fork কোনো কাজ না করেই True ফেরাত — ভুয়া সাফল্য (U2)।
# step_7_record সেই দুই মিথ্যার উপর দাঁড়িয়ে ছিল; step_4_branch শাখা না
# বানিয়েও "main" নাম ফেরাত; run_cycle-এর একমাত্র কাজ ছিল step_2_rules ডাকা —
# কোনোটিই main()-এর dispatch/envelope পথ থেকে ডাকা হত না (zero importers,
# code-search যাচাইকৃত; SPEC/CONTRIBUTING-এও কোনো রেফারেন্স নেই)। ব্রাঞ্চ/
# পুশ/রেকর্ডের আসল মালিক ব্রিজ পাইপলাইন — minimal লুপ নিজে git অপারেশন
# চালায় না। সৎ pre-push/pre-work rebase গার্ড (#161, #514) অক্ষত রাখা হলো —
# এরা সত্যিকারের কাজ করে; ভবিষ্যতে বাস্তব কনজিউমার এলে সরাসরি wire করা যাবে।

def classify_task_role(
    title: str = "", labels: Iterable[str] = (), body: str = ""
) -> str:
    present = frozenset(labels)
    if "status:runway" in present:
        return "ci-fixer"
    if "gate:pre-landing" in present:
        return "task-auditor"
    if "status:claimed" in present:
        return "coder"
    return "coder"

SPECIALIST_ROLES = frozenset({"solver", "coder", "ci-fixer", "auditor", "task-auditor"})

ENVELOPE_FORBIDDEN_PATHS = [".env*", "secrets/**", "credentials/**", "vault/**"]

PRIORITY_TIER_LABELS = ("P0", "P1", "P2", "P3", "P4")

def _detect_priority(labels: Iterable[str]) -> str:
    names = [str(l).lower() for l in labels]
    for marker, tier in (("p0", 0), ("p1", 1), ("p2", 2), ("p3", 3)):
        if any(name == marker or name.startswith(marker + "-") or name.startswith(marker + " ") for name in names):
            return PRIORITY_TIER_LABELS[tier]
    return "P4"

def _detect_group(labels: Iterable[str]) -> str:
    for name in sorted({str(l).lower() for l in labels}):
        if name in VALID_GROUPS:
            return name
    return DEFAULT_GROUP

def build_task_envelope(
    issue: dict[str, Any] | None,
    group: str = "",
    role_override: str = "",
    board_note: str = "",
) -> dict[str, Any]:
    """বাংলা: AGENT_LOOP_SPEC.md §2-র canonical task-envelope-v1 এমিট করে।

    আগে --task-envelope শুধু একটা স্টাব ছাপত {"task_contract": {"version": 1,
    "task_type": "IMPLEMENT"}} — task_id/issue/role/scope/admin_gate কিছুই ছিল না;
    ডাউনস্ট্রিম এজেন্ট envelope পেয়েও কাজ করতে পারত না। এখন বোর্ড-থেকে-পাওয়া
    issue payload (বা --issue N, বা --allow-adhoc) থেকে সৎ, deterministic
    envelope তৈরি হয়: role classify_task_role() থেকে, group fail-closed রেজিস্ট্রি
    থেকে, priority label-থেকে। body ফিল্ড ইচ্ছাকৃতভাবে বাদ (list payload-এ থাকে না;
    মিথ্যা খালি string নয়, অনুপস্থিত কী-ই সৎ)।
    """
    labels: list[str] = []
    title = ""
    issue_number: str | None = None
    state = "open"
    if isinstance(issue, dict):
        issue_number = str(issue.get("number")) if issue.get("number") is not None else None
        title = str(issue.get("title", "") or "")
        state = str(issue.get("state", "open") or "open")
        raw_labels = issue.get("labels")
        if isinstance(raw_labels, list):
            labels = [
                str(l.get("name", "")).lower() if isinstance(l, dict) else str(l).lower()
                for l in raw_labels
            ]

    resolved_group = group or _detect_group(labels)
    classified = classify_task_role(title=title, labels=labels)
    role = classified
    if role_override:
        if role_override in SPECIALIST_ROLES or role_override in ROLE_RULES:
            role = role_override
        else:
            # বাংলা: অজানা role-এ নীরব গ্রহণ নয় — সৎ warning ও classified fallback।
            log("!", f"[Envelope] unknown --role '{role_override}'; falling back to classified role '{classified}'")
            role = classified

    role_description = ROLE_RULES.get(
        role,
        ROLE_RULES["solver"] if role in ("coder", "solver") else "Execute role objectives strictly.",
    )

    specialist_prompt = "\n".join(
        [
            COMMON_RULES,
            "",
            f"ROLE: {role}",
            f"MANDATE: {role_description}",
            "PR BLUEPRINT: PR must carry 'Closes #<issue_number>' in PR description to automatically close the resolved issue on merge.",
            "CONTINUOUS DISPATCH: After completing this task, rerun continuous agent loop again.",
            "STALE-INCIDENT GUARD (U3): before claiming a CI-failure incident, verify on live main that the referenced run still fails; resolved incidents are skipped with evidence, never re-solved.",
        ]
    )

    envelope: dict[str, Any] = {
        "envelope_version": 1,
        "output_format": "task-envelope-v1",
        "task_id": f"task-{issue_number}" if issue_number else "task-adhoc",
        "issue": issue_number,
        "task_type": "IMPLEMENT",
        "group": resolved_group,
        "priority": _detect_priority(labels),
        "objective": title or ("Ad-hoc task — objective supplied by the calling agent." if not issue_number else ""),
        "role": role,
        "role_policy": "contributor",
        "role_description": role_description,
        "deliverable_type": ROLE_METADATA.get(role, {}).get("deliverable_type", "CODE_PATCH"),
        "deliverable_description": ROLE_METADATA.get(role, {}).get("description", "Execute role contract"),
        "mcp_tools": ROLE_METADATA.get(role, {}).get("mcp_tools", ["github_workflow_runs", "github_read_file"]),
        "scope": {
            "touching_files": [],
            "forbidden_paths": list(ENVELOPE_FORBIDDEN_PATHS),
        },
        "acceptance": [],
        "verification": [],
        "required_evidence": ["Reflection Evidence (why + alternatives_rejected)"],
        "stop_conditions": [],
        "admin_gate": {"required": False, "status": "NOT_REQUIRED"},
        "specialist_prompt": specialist_prompt,
        "mandatory_invariants": mandatory_invariant_checklist(),
        "execution_tier": {
            "tier_a": "Local committer: direct git rebase and test verification",
            "tier_b": "Web/MCP remote: bridge_submit_patch with server-side auto-rebase and CI proxy verification",
        },
        "submission": {
            "pathway": "bridge_submit_patch | pull_request",
            "reference": "AGENTS.md §2.1 Pathway 1 + §8 (bridge_submit_patch)",
            "base_branch": "main",
            "pr_title_prefix": "fix(open):",
            "issue_reference_required": True,
            "branch_convention": "^(feat|fix|docs|chore|test|refactor|perf|bridge|group|contributor|hotfix|release|agent)/<slug>",
        },
    }
    if labels:
        envelope["problem_statement"] = {
            "id": issue_number,
            "title": title,
            "labels": labels,
            "state": state,
        }
    if board_note:
        envelope["board_note"] = board_note
    return {"task_envelope": envelope}

def load_cadence_config(path: Path | None = None) -> dict[str, Any]:
    target = path or CADENCE_FILE
    try:
        if not target.exists():
            return {
                "cadences_hours": dict(DEFAULT_CADENCE_HOURS),
                "merged_roles": dict(DEFAULT_MERGED_ROLES),
            }
        with target.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        cadences = data.get("cadences_hours") or {}
        merged = data.get("merged_roles") or {}
        cleaned = {str(k): int(v) for k, v in cadences.items() if str(v).isdigit() and int(v) > 0}
        return {
            "cadences_hours": cleaned or dict(DEFAULT_CADENCE_HOURS),
            "merged_roles": merged or dict(DEFAULT_MERGED_ROLES),
        }
    except Exception:
        return {
            "cadences_hours": dict(DEFAULT_CADENCE_HOURS),
            "merged_roles": dict(DEFAULT_MERGED_ROLES),
        }

def canonical_role(role: str, config: dict[str, Any] | None = None) -> str:
    cfg = config or load_cadence_config()
    merged = cfg.get("merged_roles", DEFAULT_MERGED_ROLES)
    return merged.get(role, role)

def load_last_run_store(path: Path | None = None) -> dict[str, float]:
    target = path or STATE_FILE
    try:
        if not target.exists():
            return {}
        with target.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {str(k): float(v) for k, v in data.items() if str(v).replace(".", "", 1).isdigit()}
    except Exception:
        return {}

def save_last_run_store(store: dict[str, float], path: Path | None = None) -> bool:
    target = path or STATE_FILE
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(store, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False

def load_issue_lease_store(path: Path | None = None) -> dict[str, float]:
    """বাংলা: ডিসপ্যাচ করা ইস্যুগুলোর টাইমস্ট্যাম্প লোড করে (৩০ মিনিটের স্বয়ংক্রিয় লিজ ট্র্যাকিং)"""
    target = path or ISSUE_LEASE_FILE
    try:
        if not target.exists():
            return {}
        with target.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {str(k): float(v) for k, v in data.items() if str(v).replace(".", "", 1).isdigit()}
    except Exception:
        return {}

def mark_issue_leased(issue_number: str | int, now: float | None = None, path: Path | None = None) -> bool:
    """বাংলা: ইস্যু ডিসপ্যাচ হওয়ার সাথে সাথে টাইমস্ট্যাম্প রেকর্ড করে অন্য এজেন্টের কনফ্লিক্ট আটকায়"""
    target = path or ISSUE_LEASE_FILE
    now_ts = now if now is not None else time.time()
    store = load_issue_lease_store(target)
    # বাংলা: লেখার সময় মেয়াদোত্তীর্ণ entry প্রুন হয় — ফাইলে সর্বোচ্চ ৩০-মিনিট উইন্ডোর
    # তরুণ লিজ + এই মুহূর্তে লেখা entry থাকে। claimability-চেক উইন্ডোর বাইরের entry
    # যেকোনো অবস্থাতেই উপেক্ষা করে, তাই প্রুনিং আচরণ-নিরপেক্ষ — শুধু ফাইল সীমাবদ্ধ থাকে।
    store = {k: v for k, v in store.items() if (now_ts - v) < ISSUE_LEASE_SECONDS}
    store[str(issue_number)] = now_ts
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(store, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False

def role_is_due(
    role: str,
    last_run_ts: float | None,
    now_ts: float,
    config: dict[str, Any] | None = None,
) -> bool:
    cfg = config or load_cadence_config()
    cadences = cfg.get("cadences_hours", DEFAULT_CADENCE_HOURS)
    canon = canonical_role(role, cfg)
    hours = cadences.get(canon) or cadences.get(role)
    if not hours or hours <= 0:
        return False
    if last_run_ts is None:
        return True
    return ((now_ts - float(last_run_ts)) / 3600.0) >= hours

def due_roles(
    last_runs: dict[str, float] | None,
    now_ts: float | None = None,
    config: dict[str, Any] | None = None,
) -> list[str]:
    cfg = config or load_cadence_config()
    store = last_runs or {}
    now = now_ts if now_ts is not None else time.time()
    # বাংলা: state কী-ও অবশ্যই canonical হতে হবে। mark_role_run() একটি
    # merged-source role-এর টাইমস্ট্যাম্প canonical কী-তে লেখে (যেমন
    # task-auditor → auditor), তাই read-ও সেই একই কী থেকে হতে হবে —
    # নইলে canonical API নিজের mark নিজেই দেখে না এবং role প্রতি সাইকেলে
    # আবার due হয়ে যায় (state-key drift, ট্রাফিক-পুলিশ নিয়ম ৪ ভাঙে)।
    # ডিফল্ট কনফিগে canonical_role() identity — আচরণ বাইট-অপরিবর্তিত।
    return [r for r in cfg.get("cadences_hours", DEFAULT_CADENCE_HOURS) if role_is_due(r, store.get(canonical_role(r, cfg)), now, cfg)]

def mark_role_run(
    role: str,
    store: dict[str, float],
    now_ts: float | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, float]:
    cfg = config or load_cadence_config()
    canon = canonical_role(role, cfg)
    store[canon] = now_ts if now_ts is not None else time.time()
    return store

def run_verify() -> list[dict[str, Any]]:
    """Honest 8-tier verification (U2 truth — no fabricated PASS).

    বাংলা: প্রতিটি টিয়ার এখন সত্যিই চেক হয় (সস্তা, dependency-মুক্ত সেলফ-চেক);
    ব্যর্থ বা exception হলে passed=False। আগের সংস্করণ ৮টি টিয়ারই শর্তহীনভাবে
    PASS ছাপাত — যাচাই-ভয়াবহতা (false assurance) U2 লঙ্ঘন; পুরনো ১২৫০-লাইন
    লুপে এই ত্রুটি PR #1498 ঠিক করেছিল, #1526 রিরাইটে আবার ফিরে এসেছিল।

    চুক্তি: টিয়ার এমিশন অবশ্যই লিটারাল {"tier": N, ...} ডিক্ট হতে হবে —
    Loop-Contract Parity Guard (#118) এই লিটারাল প্যাটার্ন grep করে docs/
    AGENT_LOOP_SPEC.md §4-এর "tiers 1–8" SSOT-এর সাথে মেলায় (fail-closed)।
    তাই ফাংশন-কল দিয়ে ভ্যারিয়েবল-জাত dict বানানো যাবে না; honesty ও
    লিটারাল-এমিশন দুটোই একসাথে রাখতে হবে।
    """

    def _run(fn: Any) -> bool:
        try:
            return bool(fn())
        except Exception:
            return False

    def _json_ok() -> bool:
        # বাংলা: থাকা ফাইলগুলো অবশ্যই বৈধ JSON হতে হবে; অনুপস্থিত হলে বাধা নেই।
        for p in (CADENCE_FILE, STATE_FILE):
            if p.exists():
                json.loads(p.read_text(encoding="utf-8"))
        return True

    def _yaml_ok() -> bool:
        wf = REPO_ROOT / ".github" / "workflows"
        if not wf.is_dir():
            return False
        files = [p for p in wf.iterdir() if p.suffix in (".yml", ".yaml")]
        return bool(files) and all(p.stat().st_size > 0 for p in files)

    def _binary_ok() -> bool:
        agents_dir = REPO_ROOT / "scripts" / "agents"
        for p in agents_dir.glob("*.py"):
            blob = p.read_bytes()
            if b"\x00" in blob or b"\x7fELF" in blob:
                return False
        return True

    evidence: list[dict[str, Any]] = [
        {
            "tier": 1,
            "name": "syntax_py_compile",
            "passed": _run(
                lambda: compile(
                    Path(__file__).read_text(encoding="utf-8"),
                    "continuous_agent_loop.py",
                    "exec",
                )
                is not None,
            ),
        },
        {"tier": 2, "name": "json_validity", "passed": _run(_json_ok)},
        {"tier": 3, "name": "yaml_validity", "passed": _run(_yaml_ok)},
        {"tier": 4, "name": "binary_guard", "passed": _run(_binary_ok)},
        {
            "tier": 5,
            "name": "contract_guard",
            "passed": _run(lambda: CONTRACT_VERSION == "agent-loop-contract/1"),
        },
        {
            "tier": 6,
            "name": "group_registry_guard",
            "passed": _run(
                lambda: isinstance(VALID_GROUPS, frozenset) and "core" in VALID_GROUPS
            ),
        },
        {
            "tier": 7,
            "name": "envelope_determinism",
            "passed": _run(
                lambda: build_task_contract("verify-probe")
                == build_task_contract("verify-probe")
            ),
        },
        {
            "tier": 8,
            "name": "machine_path_isolation",
            "passed": _run(
                lambda: Path(__file__).resolve().parents[2] == REPO_ROOT
                and (REPO_ROOT / "scripts" / "agents").is_dir()
            ),
        },
    ]

    for ev in evidence:
        print(f"[{ev['tier']}/8] {ev['name']}: {'PASS' if ev['passed'] else 'FAIL'}")
    print(f"CONTRACT_VERSION={CONTRACT_VERSION}")
    return evidence

def run_dispatch_cycle(args: argparse.Namespace) -> int:
    """One dispatch cycle: board query → solver/envelope dispatch or cadence role.

    বাংলা: একক সাইকেলের পরিষ্কার ডিসপ্যাচ এক্সিকিউশন। বাহ্যিক শিডিউলার বা রানার
    দ্বারা সাইকেল পরিচালিত হয়।
    """
    cmd = [
        "gh", "issue", "list",
        "--repo", UPSTREAM_REPO,
        "--json", "number,labels",
        "--state", "open",
        "--limit", "100",
    ]
    # বাংলা: main() এখানে run_cmd() বাইপাস করে সরাসরি subprocess.run() ডাকছিল —
    # gh CLI অনুপস্থিত মেশিনে FileNotFoundError ছুঁড়ে পুরো লুপ crash করত
    # (স্ট্যাকট্রেস সহ)। এখন সৎভাবে জানায় বোর্ড জিজ্ঞেস করা যায়নি, solver
    # dispatch বাদ দিয়ে cadence পাথ চলতে থাকে — নীরব মিথ্যা "clean" নয়।
    # --repo UPSTREAM_REPO: দুই কপির বোর্ড SSOT এখন pick_next_issue()-এর সাথে
    # একই — আগে cwd-র remote-নির্ভর query ছিল, private mirror থেকে চালালে ভুল
    # বোর্ড পড়ত। gh non-zero exit এখন "empty board" নয়, সৎ board_unavailable।
    board_unavailable = False
    board_error = ""
    raw: list[dict[str, Any]] = []
    if _offline_requested(getattr(args, "offline", False)):
        # বাংলা: --offline আগে শুধু parse হতো, main-path একে উপেক্ষা করত —
        # অফলাইন মেশিনেও লুপ নেটওয়ার্কে gh কল করত ও timeout খেত। এখন সৎভাবে
        # বোর্ড-কোয়েরি বাদ (step_2_rules()-এর offline আচরণের সাথে একরূপ)।
        board_unavailable = True
        board_error = "offline mode (--offline/OFFLINE env): board query honestly skipped"
    else:
        try:
            p = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, errors="replace")
            if p.returncode != 0:
                board_unavailable = True
                board_error = (p.stderr or "").strip() or f"gh exit code {p.returncode}"
            elif p.stdout.strip():
                try:
                    parsed = json.loads(p.stdout)
                    raw = parsed if isinstance(parsed, list) else []
                except Exception:
                    board_unavailable = True
                    board_error = "unparseable gh issue list output"
        except FileNotFoundError:
            board_unavailable = True
            board_error = "gh CLI not found on PATH"

    envelope_mode = args.task_envelope or args.emit_prompt or args.emit_contract

    if envelope_mode:
        # বাংলা: SPEC §4b — envelope মোডে banner (COMMON_RULES) stderr-এ যায়,
        # stdout শুধুই envelope JSON থাকে যাতে pipe/parse নিরাপদ থাকে।
        print(COMMON_RULES, file=sys.stderr)
        print("=" * 52, file=sys.stderr)
        if args.emit_prompt or args.emit_contract:
            print(
                "DEPRECATED: --emit-prompt/--emit-contract are shims for --task-envelope "
                "(AGENT_LOOP_SPEC §4); removal is gated on private-mirror parity — do not remove in a drive-by change.",
                file=sys.stderr,
            )

        target_issue: dict[str, Any] | None = None
        note = ""
        if args.issue:
            # বাংলা: --issue N → নির্দিষ্ট issue-র সৎ এনভেলপ; gh ব্যর্থ হলে
            # crash নয়, সৎ board_note সহ envelope (নীরব স্টাব নয়)।
            if board_unavailable:
                note = f"issue board unavailable ({board_error}); envelope emitted without problem_statement"
            else:
                v_cmd = [
                    "gh", "issue", "view", str(args.issue),
                    "--repo", UPSTREAM_REPO,
                    "--json", "number,title,labels,state",
                ]
                try:
                    vp = subprocess.run(v_cmd, cwd=REPO_ROOT, capture_output=True, text=True, errors="replace")
                    if vp.returncode != 0:
                        note = f"gh issue view {args.issue} failed: {(vp.stderr or '').strip() or vp.returncode}"
                    else:
                        target_issue = json.loads(vp.stdout)
                except FileNotFoundError:
                    note = "gh CLI not found on PATH"
                except Exception as exc:
                    note = f"gh issue view error: {exc}"
        elif board_unavailable:
            note = f"issue board unavailable ({board_error}); envelope emitted without problem_statement"
        else:
            picked = pick_next_issue(issues=raw)
            if picked:
                target_issue = next((i for i in raw if str(i.get("number")) == picked), None)
                # বাংলা: board query-র list payload-এ title থাকে না (gh issue list
                # --json number,labels) — auto-pick পথে target_issue শুধু number+labels
                # বহন করত, ফলে এমিটেড envelope-এ objective="" যেত এবং এজেন্ট
                # envelope পেয়েও কাজটা কী তা বুঝতে পারত না (SPEC §2 objective ফাঁকা)।
                # --issue পথের মতোই নির্বাচিত issue-র title/state hydrate করা হয়;
                # hydrate ব্যর্থ হলে সৎ board_note — নীরব খালি objective নয়।
                if target_issue is not None and target_issue.get("title") is None:
                    h_cmd = [
                        "gh", "issue", "view", str(picked),
                        "--repo", UPSTREAM_REPO,
                        "--json", "number,title,labels,state",
                    ]
                    try:
                        hp = subprocess.run(h_cmd, cwd=REPO_ROOT, capture_output=True, text=True, errors="replace")
                        if hp.returncode == 0 and hp.stdout.strip():
                            target_issue = json.loads(hp.stdout)
                        else:
                            note = f"gh issue view {picked} failed: {(hp.stderr or '').strip() or hp.returncode}; envelope emitted without title"
                    except FileNotFoundError:
                        note = "gh CLI not found on PATH; envelope emitted without title"
                    except Exception as exc:
                        note = f"gh issue view error: {exc}; envelope emitted without title"
            elif not args.allow_adhoc:
                print(
                    "No claimable issue on the board. Pass --allow-adhoc to emit an ad-hoc envelope.",
                    file=sys.stderr,
                )
                return 1

        # বাংলা: envelope-পথেও lease mark হবে — mark_issue_leased() আগে শুধু
        # dispatch-পথে ছিল; কিন্তু --task-envelope auto-pick এবং --issue N — এই দুই
        # পথেও issue এজেন্টকে অর্পণই হয়, lease ছাড়া একই মেশিনে ৩০ মিনিটের মধ্যে
        # পুনঃরান করলে pick_next_issue একই issue আবার বেছে নিত (lease-ফিচার যে
        # ডুপ্লিকেট-ডিসপ্যাচ আটকায় তা SPEC-ক্যাননিকাল envelope মোডেই ঘটত)।
        # শুধু সত্যিকারের resolved target-এ mark — board-unavailable/ad-hoc এনভেলপে নয়।
        if target_issue is not None and target_issue.get("number") is not None:
            mark_issue_leased(target_issue["number"])
        envelope = build_task_envelope(
            target_issue,
            group=args.group,
            role_override=args.role,
            board_note=note,
        )
        print(json.dumps(envelope, indent=2))
        return 0

    print(COMMON_RULES)
    print("=" * 52)

    if args.auto_pr:
        # বাংলা: pipeline.yml workflow_dispatch --auto-pr পাঠায় (#89)। minimal
        # লুপ নিজে PR খোলে না — সৎ stderr নোট, stdout অপরিবর্তিত।
        print(
            "--auto-pr: pipeline-parity flag — the minimal loop opens no PR itself; "
            "auto_bridge_pr_opener.py owns PR opening in the workflow.",
            file=sys.stderr,
        )
    if board_unavailable:
        log("!", f"issue board unavailable ({board_error}) — skipping solver dispatch. Cadence roles still evaluated.")
    else:
        picked = pick_next_issue(issues=raw)
        if picked:
            # বাংলা: classify_task_role() এখন dispatch-এ তার সত্যিকারের কাজ পায় —
            # status:runway → ci-fixer, gate:pre-landing → task-auditor হলেও
            # dispatch টেক্সটে শুধু সৎ classification-নোট যোগ হয়; solver-এর
            # claim-first mandate অপরিবর্তিত (#1530-র zero-dispatch-change শৃঙ্খলা)।
            picked_issue = next((i for i in raw if str(i.get("number")) == picked), None)
            picked_labels = []
            if isinstance(picked_issue, dict) and isinstance(picked_issue.get("labels"), list):
                picked_labels = [
                    str(l.get("name", "")).lower() for l in picked_issue["labels"] if isinstance(l, dict)
                ]
            classified = classify_task_role(labels=picked_labels)
            dispatch_role = args.role or "solver"
            if args.role and args.role not in SPECIALIST_ROLES and args.role not in ROLE_RULES:
                log("!", f"unknown --role '{args.role}'; dispatching as solver")
                dispatch_role = "solver"
            mandate = ROLE_RULES.get(
                dispatch_role,
                ROLE_RULES["solver"] if dispatch_role in ("coder", "solver") else "Execute role objectives strictly.",
            )
            concurrency = "Unlimited concurrency allowed" if dispatch_role in ("solver", "coder") else "Single-runner role lock"
            suffix = f" (classified specialist: {classified})" if classified not in ("coder", "solver") and dispatch_role in ("solver", "coder") else ""
            mark_issue_leased(picked)
            print(f"ASSIGNED ROLE: {dispatch_role}{suffix} ({concurrency})\nROLE MANDATE: {mandate}")
            print(f"ACTION: Highest-priority unclaimed issue = #{picked}. Solve root cause and submit PR with 'Closes #{picked}' in PR description to close it on merge.")
            print("CONTINUOUS DISPATCH: After completing this task, rerun continuous agent loop again.")
            print("STALE-INCIDENT GUARD (U3 Live Validity): before claiming a CI-failure incident, verify on live main that the referenced run still fails; resolved incidents are skipped with evidence, never re-solved.")
            return 0

    cfg = load_cadence_config()
    cadence = cfg.get("cadences_hours", {})
    state = load_last_run_store()
    now = time.time()

    # বাংলা: docstring-এর traffic-police নিয়ম ৩ ("If no open issues exist ->
    # Reset/zero cadence timers so scheduled roles can run immediately") আগে
    # কোডে কখনো বাস্তবায়িত হয়নি — স্থায়ীভাবে ব্যস্ত বোর্ডে শিডিউল-রোলগুলো
    # চিরকালে অপেক্ষা করত। বোর্ড সত্যিই খালি (query সফল, raw শূন্য) হলে এখন
    # টাইমার রিসেট হয় এবং এই সাইকেলেই প্রথম cadence রোল তাৎক্ষণিক চলে।
    if not board_unavailable and not raw and state:
        state = {}
        save_last_run_store(state)
        log("*", "board is clean — cadence timers reset (docstring rule 3); scheduled roles may run immediately.")

    # বাংলা: cadence due-check এখন এক SSOT-এ — canonical API (due_roles →
    # role_is_due → mark_role_run)। আগের inline হিসাব state[role] কাঁচা কী-তে
    # পড়ত-লিখত এবং merged_roles উপেক্ষা করত; ফলে canonical mark অদৃশ্য হয়ে
    # একই লজিক্যাল role বারবার ডিসপ্যাচ হত (live main 3a2dabf-এ প্রমাণিত:
    # mark_role_run('task-auditor') → store['auditor'], inline loop
    # store['task-auditor'] খোঁজে — ১০ ঘণ্টা পরেও পুনঃ-ডিসপ্যাচ; ট্রাফিক-পুলিশ
    # নিয়ম ৪ ভাঙে)। due_roles() cadences_hours-এর ক্রমেই ফেরে, তাই প্রথম due
    # role আগের মতোই প্রথমটি — ডিসপ্যাচ টেক্সট ও ক্রম বাইট-অপরিবর্তিত;
    # ডিফল্ট কনফিগে canonical_role() identity, তাই আচরণে কোনো পরিবর্তন নেই।
    # immediate state-advance (নিয়ম ৪) অক্ষত: mark → save → print → return।
    # বাংলা: P0 Drainage Invariant (Rule 5) — যদি বোর্ডে কোনো P0-critical
    # ইস্যু সক্রিয় থাকে (এমনকি অন্য রানার যদি অস্থায়ী লিজ নিয়েও থাকে), তবুও
    # কোনো রুটিন অডিট/স্কাউট রোল রান হবে না যাতে ব্যাকলগ আটকে রেখে অগুরুত্বপূর্ণ
    # কাজ না হয়। P0 সমাধান না হওয়া পর্যন্ত ক্যাডেন্স স্থগিত থাকবে।
    if not board_unavailable and has_open_p0_blocker(raw):
        log("!", "P0 Drainage Invariant: Active P0-critical blocker detected on board. Holding cadence roles until P0 issues are resolved.")
        print("ACTION: System is draining P0-critical architectural backlog. Routine cadence roles held.")
        return 0

    for role in due_roles(state, now, cfg):
        mark_role_run(role, state, now, cfg)
        save_last_run_store(state)
        mandate = ROLE_RULES.get(role, "Execute role objectives strictly.")
        print(f"ASSIGNED ROLE: {role} (Single-runner role lock)\nROLE MANDATE: {mandate}")
        print("CONTINUOUS DISPATCH: After completing this task, rerun continuous agent loop again.")
        return 0

    print("ACTION: System is clean and up to date.")
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(description="SupremeAI Minimal Continuous Loop")
    parser.add_argument("--verify-only", action="store_true", help="Run 8-tier verification only")
    parser.add_argument("--task-envelope", action="store_true", help="Emit the canonical task-envelope-v1 JSON (SPEC §2)")
    parser.add_argument("--emit-prompt", action="store_true", help="Deprecated shim for --task-envelope")
    parser.add_argument("--emit-contract", action="store_true", help="Deprecated shim for --task-envelope")
    parser.add_argument("--group", type=str, default="", help="Group override (fail-closed against VALID_GROUPS, exit 2)")
    parser.add_argument("--loop", action="store_true", help="Shared flag (SPEC §4b): single dispatch cycle per invocation (scheduler is the outer loop)")
    parser.add_argument("--offline", action="store_true", help="Run offline (board query honestly skipped)")
    parser.add_argument("--pick-next", action="store_true", help="Shared flag (SPEC §4b): pick highest-priority claimable issue (default dispatch behavior)")
    parser.add_argument("--issue", type=str, default="", help="Target a specific issue number for the task envelope")
    parser.add_argument("--role", type=str, default="", help="Role override (validated against ROLE_RULES + specialist classes, honest fallback)")
    parser.add_argument("--max-tasks", dest="max_tasks", type=int, default=1, help="Max tasks per dispatch cycle (minimal loop honors 1; >1 gets an honest stderr note)")
    parser.add_argument("--allow-adhoc", dest="allow_adhoc", action="store_true", help="Emit an ad-hoc envelope when no claimable issue exists")
    parser.add_argument("--auto-pr", action="store_true", help="Accepted for pipeline parity (#89); the minimal loop itself opens no PR")
    args, _ = parser.parse_known_args()

    if args.group and args.group not in VALID_GROUPS:
        log("❌", f"--group '{args.group}' is not in the VALID_GROUPS registry {sorted(VALID_GROUPS)} (SPEC §3 fail-closed)")
        return 2

    if args.verify_only:
        evidence = run_verify()
        failed = [ev for ev in evidence if not ev.get("passed")]
        if failed:
            print(
                "verification FAILED: "
                + ", ".join(f"tier {ev['tier']} ({ev['name']})" for ev in failed),
                file=sys.stderr,
            )
            return 1
        return 0

    if args.loop:
        # বাংলা: এই স্ক্রিপ্ট একটি পরিষ্কার একক-ডিসপ্যাচ সাইকেল চালায়। বাইরের শিডিউলার/রানারই
        # পুনরাবৃত্তি নিয়ন্ত্রণ করে; ইন-প্রসেস অসীম লুপ প্রক্রিয়ার অপব্যবহার বন্ধ রাখা হয়েছে।
        print("--loop: runs ONE dispatch cycle per invocation; the scheduler/orchestrator is the outer loop.", file=sys.stderr)

    if args.max_tasks is not None and args.max_tasks <= 0:
        print("--max-tasks <= 0: dispatch suppressed by caller.", file=sys.stderr)
        return 0
    if args.max_tasks is not None and args.max_tasks > 1:
        print(
            "--max-tasks > 1: this loop dispatches exactly ONE task per cycle "
            "(the scheduler/orchestrator is the outer loop); honoring 1.",
            file=sys.stderr,
        )

    return run_dispatch_cycle(args)

if __name__ == "__main__":
    sys.exit(main())
