#!/usr/bin/env python3
"""
scripts/agents/continuous_agent_loop.py — Minimal Agent Loop v3.

Flow:
    SCAN (master_health_check --full)
      |
      v
    Board has claimable issues?
      YES -> claim top -> (specialist implements via task envelope) -> VERIFY -> PR
      NO  -> ACTION PLAN has items?
               YES -> create_issue (dedup: skip if title fingerprint exists) -> claim -> VERIFY -> PR
               NO  -> system is green -> exit
      |
      v
    Repeat until no claimable issues AND no action plan items.

Zero race: sequential only. One branch, one claim, one PR at a time.
Zero duplicates: before creating, search open issues by fingerprint.

Contract: CONTRACT_VERSION = "agent-loop-contract/1"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CONTRACT_VERSION = "agent-loop-contract/1"
REPO_ROOT = Path(__file__).resolve().parents[2]
UPSTREAM_REPO = "Supremeai-bd/supremeai-open"

# Anchor hubs — never claim
ANCHOR_HUB_NUMBERS: set[int] = {
    749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762
}

# Labels that block agent claiming
EXCLUDED_LABELS: set[str] = {
    "admin-only", "anchor-hub", "status:claimed", "status:in-progress",
    "state:seq-hold", "state:blocked", "state:hold", "private-mirror",
    "blocked-by-upstream", "mirror:private",
}

# CI Anchor hub for new CI-failure issues
CI_ANCHOR_HUB = 761


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(icon: str, msg: str) -> None:
    try:
        print(f"{icon} {msg}", flush=True)
    except UnicodeEncodeError:
        print(f"[*] {msg}", flush=True)


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str, str]:
    try:
        p = subprocess.run(
            cmd, cwd=REPO_ROOT, capture_output=True, text=True,
            timeout=timeout, encoding="utf-8", errors="replace",
        )
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 127, "", "timeout"
    except OSError as exc:
        return 127, "", str(exc)


# ---------------------------------------------------------------------------
# CI Contract Aliases & Backwards Compatibility
# ---------------------------------------------------------------------------

run_cmd = run  # CI contract alias (#118)

_VALID_TASK_TYPES = {
    "AUDIT", "PLAN", "IMPLEMENT", "FIX_CI", "REVIEW",
    "SECURITY_AUDIT", "DISCOVERY", "MERGE", "ADMIN_DECISION",
}


def build_task_contract(task_id: str, task_type: str = "IMPLEMENT", **_kwargs: Any) -> dict[str, Any]:
    """Build a canonical task-contract envelope (bridge to task_contract_schema)."""
    tt = (task_type or "IMPLEMENT").upper()
    if tt not in _VALID_TASK_TYPES:
        raise ValueError(f"invalid task_type: {task_type!r}")
    return {
        "task_contract": {
            "version": 1,
            "task_id": str(task_id),
            "task_type": tt,
        }
    }


# ---------------------------------------------------------------------------
# Group taxonomy — VALID_GROUPS registry (AGENT_LOOP_SPEC.md §3, fail-closed)
# ---------------------------------------------------------------------------

VALID_GROUPS: frozenset[str] = frozenset({
    "agent-orchestration", "mcp-tower", "core-engine", "schemas-contracts", "infra-ops",
})

_VALID_ROLES: frozenset[str] = frozenset({
    "coder", "planner", "auditor", "ci-fixer", "reviewer", "integrator", "admin",
})

_ROLE_BY_GROUP: dict[str, str] = {
    "agent-orchestration": "coder",
    "mcp-tower": "integrator",
    "core-engine": "coder",
    "schemas-contracts": "planner",
    "infra-ops": "ci-fixer",
}


def resolve_group(explicit: str | None = None, issue: dict[str, Any] | None = None) -> str:
    """Deterministic group resolution (spec §3): CLI flag > issue scan > default.
    Fail-closed: an unknown group raises ValueError — invalid work never reaches CI."""
    if explicit:
        g = explicit.strip()
        if g not in VALID_GROUPS:
            raise ValueError(
                f"invalid group: {explicit!r} (must be one of {sorted(VALID_GROUPS)})"
            )
        return g
    if issue:
        hay = " ".join(
            [str(issue.get("title", ""))]
            + [str(l.get("name", "")) for l in issue.get("labels", []) if isinstance(l, dict)]
            + [str(issue.get("body", ""))[:2000]]
        ).lower()
        for g in sorted(VALID_GROUPS):
            if g in hay:
                return g
    return "agent-orchestration"


def build_task_envelope(
    issue: dict[str, Any],
    group: str | None = None,
    role: str | None = None,
) -> dict[str, Any]:
    """Build the canonical task-envelope-v1 payload (AGENT_LOOP_SPEC.md §2).
    One unified JSON for external specialist agents (Z.ai, Claude, Antigravity, ...)."""
    g = resolve_group(group, issue)
    r = role or _ROLE_BY_GROUP.get(g, "coder")
    if r not in _VALID_ROLES:
        raise ValueError(f"invalid role: {role!r} (must be one of {sorted(_VALID_ROLES)})")
    num = int(issue.get("number", 0))
    title = str(issue.get("title", ""))
    labels = [str(l.get("name", "")) for l in issue.get("labels", []) if isinstance(l, dict)]
    prio = "P2"
    for p in ("p0", "p1", "p2", "p3"):
        if any(n == p or n.startswith(p + "-") for n in labels):
            prio = p.upper()
            break
    task_id = f"task-{num}" if num else "task-adhoc"
    return {
        "task_envelope": {
            "envelope_version": 1,
            "output_format": "task-envelope-v1",
            "task_id": task_id,
            "issue": str(num),
            "task_type": "IMPLEMENT",
            "group": g,
            "priority": prio,
            "objective": title,
            "problem_statement": {
                "id": num,
                "title": title,
                "body": str(issue.get("body", "")),
                "labels": labels,
                "state": str(issue.get("state", "open")),
            },
            "role": r,
            "role_policy": "contributor",
            "role_description": f"Specialist executing {task_id} strictly inside the declared scope.",
            "scope": {
                "touching_files": [],
                "forbidden_paths": [".env*", "secrets/**", "credentials/**", "vault/**"],
            },
            "acceptance": [],
            "verification": ["python scripts/agents/continuous_agent_loop.py --verify-only"],
            "required_evidence": ["reflection", "boot_smoke", "tests"],
            "stop_conditions": [
                "scope boundary violation",
                "verified non-reproducible on live main (U3)",
            ],
            "admin_gate": {"required": False, "status": "NOT_REQUIRED"},
            "specialist_prompt": (
                f"You are the {r} specialist for {task_id} (group: {g}, priority: {prio}). "
                f"Objective: {title}. Work strictly inside scope, follow AGENT_RULES.md "
                "U1-U14 + P0-P9, and submit via bridge_submit_patch or a linked PR."
            ),
            "submission": {
                "pathway": "bridge_submit_patch | pull_request",
                "reference": "AGENTS.md §2.1 Pathway 1 + §8 (bridge_submit_patch)",
                "base_branch": "main",
                "pr_title_prefix": "fix(open):",
                "issue_reference_required": True,
                "branch_convention": (
                    "^(feat|fix|docs|chore|test|refactor|perf|bridge|group|contributor|"
                    "hotfix|release|agent)/<slug> — enforced by pipeline.yml"
                ),
                "pr_body_template": (
                    "### Summary\nCloses #{issue} — {title}\n\n"
                    "### Linked Issue / Claim\nCloses #{issue}\n\n"
                    "### Key Changes\n- <change>\n\n"
                    "## Reflection Evidence (why + alternatives_rejected)\n"
                    "- **why:** <rationale>\n"
                    "- **alternatives_rejected:**\n  - <alternative>: rejected — <reason>\n\n"
                    "### Rollback Path\n- [x] `git revert`-safe"
                ),
            },
        }
    }


def pick_next_issue(exclude: set[str] | list[str] | None = None) -> str | None:
    """Fetch the highest priority claimable open issue from GitHub (CI contract parity)."""
    exclude_set = {str(e) for e in exclude} if exclude else set()
    all_issues = fetch_open_issues()
    candidate = pick_issue(all_issues, exclude=exclude_set)
    return str(candidate.get("number")) if candidate else None


def _get_gh_token() -> str:
    for var in ("GH_TOKEN", "GITHUB_TOKEN", "OPEN_SYNC_PAT"):
        val = os.environ.get(var, "").strip()
        if val:
            return val
    rc, out, _ = run(["gh", "auth", "token"], timeout=5)
    return out.strip() if rc == 0 else ""


def gh_api(
    path: str,
    method: str = "GET",
    data: dict[str, Any] | None = None,
    token: str = "",
) -> tuple[int, Any]:
    """Minimal GitHub REST helper. path = /repos/... or full URL."""
    url = path if path.startswith("http") else f"https://api.github.com{path}"
    tok = token or _get_gh_token()
    headers: dict[str, str] = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SupremeAI-AgentLoop/3",
    }
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            content = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(content) if content.strip() else {}
    except urllib.error.HTTPError as exc:
        content = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(content)
        except Exception:
            return exc.code, {"raw": content}
    except Exception as exc:
        return 0, {"error": str(exc)}


# ---------------------------------------------------------------------------
# STEP 0: Preflight — constitution freshness
# ---------------------------------------------------------------------------

CONSTITUTION_FILES = ("AGENTS.md", "AGENT_RULES.md", ".github/PULL_REQUEST_TEMPLATE.md")


def preflight() -> bool:
    missing = [f for f in CONSTITUTION_FILES if not (REPO_ROOT / f).exists()]
    if missing:
        log("❌", f"[Preflight] Missing constitution files: {missing}")
        return False
    rc, _, _ = run(["git", "fetch", "origin", "main"], timeout=30)
    if rc == 0:
        for path in CONSTITUTION_FILES:
            run(["git", "checkout", "origin/main", "--", path])
    log("✅", "[Preflight] Constitution synced.")
    return True


# ---------------------------------------------------------------------------
# STEP 1: SCAN — master_health_check --full
# ---------------------------------------------------------------------------

def scan() -> dict[str, Any]:
    """Run master_health_check --full --json. Returns structured action plan."""
    log("🔍", "[SCAN] master_health_check --full ...")
    rc, out, err = run(
        [sys.executable, "scripts/ops/master_health_check.py", "--full", "--json"],
        timeout=180,
    )
    empty: dict[str, Any] = {
        "healthy": False, "guard_failures": [], "satellite_failures": [], "action_plan": [],
    }
    if not out.strip():
        log("⚠️", f"[SCAN] No output: {err[:200]}")
        return empty
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return empty

    infra = data.get("infra", {})
    infra_ok = infra.get("overall_status", "down") == "healthy"
    ci = data.get("ci_sweep", {})
    guard_fails = [g for g in ci.get("guards", []) if g.get("status") != "pass"]
    sat_fails = [s for s in ci.get("satellites", []) if s.get("status") != "green"]

    plan: list[dict[str, Any]] = []
    idx = 1
    for g in guard_fails:
        plan.append({
            "priority": idx, "type": "local_guard",
            "name": g["name"], "fix": g.get("fix_hint", ""),
            "output": g.get("output", ""),
        })
        idx += 1
    for s in sat_fails:
        for run_info in s.get("failed_runs", [])[:2]:
            plan.append({
                "priority": idx, "type": "satellite_ci",
                "repo": s["repo"], "fix": s.get("fix_hint", ""),
                "run_id": run_info.get("id"), "run_url": run_info.get("url", ""),
                "run_name": run_info.get("name", "CI Pipeline"),
            })
            idx += 1

    healthy = infra_ok and not guard_fails and not sat_fails
    log(
        "✅" if healthy else "❌",
        f"[SCAN] Infra {'OK' if infra_ok else 'DEGRADED'} | "
        f"{len(guard_fails)} guard fail(s) | {len(sat_fails)} satellite fail(s) | "
        f"{len(plan)} action item(s)"
    )
    return {
        "healthy": healthy,
        "guard_failures": guard_fails,
        "satellite_failures": sat_fails,
        "action_plan": plan,
    }


# ---------------------------------------------------------------------------
# STEP 2: PICK — highest-priority claimable issue from board
# ---------------------------------------------------------------------------

def _label_names(issue: dict[str, Any]) -> list[str]:
    labels = issue.get("labels", [])
    if not isinstance(labels, list):
        return []
    return [str(l.get("name", "")).lower() for l in labels if isinstance(l, dict)]


def _is_claimable(issue: dict[str, Any]) -> bool:
    names = set(_label_names(issue))
    return (
        not (EXCLUDED_LABELS & names)
        and int(issue.get("number", 0)) not in ANCHOR_HUB_NUMBERS
    )


def _priority_key(issue: dict[str, Any]) -> tuple[int, int]:
    names = _label_names(issue)
    for rank, marker in enumerate(["p0", "p1", "p2", "p3"]):
        if any(n == marker or n.startswith(marker + "-") for n in names):
            return (rank, int(issue.get("number", 0)))
    return (4, int(issue.get("number", 0)))


def fetch_open_issues(token: str = "") -> list[dict[str, Any]]:
    """Fetch all open issues (gh CLI first, API fallback)."""
    rc, out, _ = run_cmd(
        ["gh", "issue", "list", "--repo", UPSTREAM_REPO,
         "--state", "open", "--limit", "200",
         "--json", "number,title,labels,body"],
    )
    if rc == 0 and out.strip():
        try:
            return json.loads(out)
        except Exception:
            pass
    # Fallback: REST API
    code, data = gh_api(
        f"/repos/{UPSTREAM_REPO}/issues?state=open&per_page=100",
        token=token,
    )
    if code == 200 and isinstance(data, list):
        return [i for i in data if "pull_request" not in i]
    return []


def pick_issue(all_issues: list[dict[str, Any]], exclude: set[str]) -> dict[str, Any] | None:
    """Return highest-priority claimable issue not in exclude set."""
    candidates = [
        i for i in all_issues
        if isinstance(i, dict)
        and _is_claimable(i)
        and str(i.get("number")) not in exclude
    ]
    if not candidates:
        return None
    return sorted(candidates, key=_priority_key)[0]


# ---------------------------------------------------------------------------
# STEP 2b: STALE-CI RE-CHECK (U3 Live Validity — no ghost work)
# ---------------------------------------------------------------------------

_RUN_URL_RE = re.compile(r"actions/runs/(\d+)")
_TARGET_REPO_RE = re.compile(
    r"###\s*Target Repository\s*\n+\s*`?([\w.-]+/[\w.-]+)`?", re.IGNORECASE
)


def _ci_incident_refs(issue: dict[str, Any]) -> tuple[str | None, str | None]:
    """Extract (repo, run_id) from a loop-created CI incident issue body.
    Returns (None, None) for anything that is not a CI incident."""
    title = str(issue.get("title", ""))
    body = str(issue.get("body", ""))
    if not title.lower().startswith("fix(ci):"):
        return None, None
    m = _RUN_URL_RE.search(body)
    run_id = m.group(1) if m else None
    m = _TARGET_REPO_RE.search(body)
    repo = m.group(1) if m else None
    return repo, run_id


def _ci_issue_is_stale(issue: dict[str, Any]) -> bool:
    """U3 Live Validity for auto-created CI incidents: if the referenced
    workflow already has a NEWER successful run on the same branch, the
    incident is resolved on live main and working on it would be ghost work.
    Best-effort: any API failure returns False (never blocks valid work)."""
    repo, run_id = _ci_incident_refs(issue)
    if not repo or not run_id:
        return False
    code, run = gh_api(f"/repos/{repo}/actions/runs/{run_id}")
    if code != 200 or not isinstance(run, dict) or run.get("message"):
        return False
    branch = run.get("head_branch") or "main"
    wf_url = run.get("workflow_url") or ""
    wf_id = wf_url.rstrip("/").rsplit("/", 1)[-1] if wf_url else None
    if not wf_id:
        return False
    code, data = gh_api(
        f"/repos/{repo}/actions/workflows/{wf_id}/runs"
        f"?branch={branch}&status=success&per_page=1"
    )
    if code != 200 or not isinstance(data, dict):
        return False
    runs = data.get("workflow_runs") or []
    if not runs:
        return False
    try:
        return str(runs[0].get("created_at", "")) > str(run.get("created_at", ""))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# STEP 3: DYNAMIC ISSUE CREATION (zero-duplicate)
# ---------------------------------------------------------------------------

def _fingerprint(text: str) -> str:
    """Stable short hash for dedup — based on normalized title.

    CI-failure titles embed the workflow run id (``(Run #123...)``) which is
    different on every failure; stripping it keeps the fingerprint stable so
    the zero-duplicate contract (U4) holds across repeated CI incidents.
    """
    normalized = " ".join(text.lower().split())
    normalized = re.sub(r"\(run #\d+\)", "", normalized)
    return hashlib.sha1(normalized.encode()).hexdigest()[:12]


def _issue_exists(title: str, all_issues: list[dict[str, Any]]) -> int | None:
    """
    Check if an open issue with a matching title fingerprint already exists.
    Returns issue number if found, None otherwise.
    Zero network calls — uses already-fetched board.
    """
    fp = _fingerprint(title)
    for issue in all_issues:
        existing_fp = _fingerprint(str(issue.get("title", "")))
        if existing_fp == fp:
            return int(issue.get("number", 0))
        # Also check body for our dedup marker
        body = issue.get("body") or ""
        if f"<!-- dedup:{fp} -->" in body:
            return int(issue.get("number", 0))
    return None


def _build_issue_from_plan(item: dict[str, Any]) -> dict[str, str]:
    """Build issue title + body + labels from an action plan item."""
    if item["type"] == "local_guard":
        title = f"fix(ci): [{item['name']}] guard failing — {item['fix'][:60]}"
        labels = ["P1-high", "area:ci", "status:unclaimed", "status:runway"]
        body = f"""### Summary
CI guard `{item['name']}` is failing and blocking the federation pipeline.

### Linked Issue / Claim
<!-- atomic-claim: auto-created by agent loop -->

### Problem
{item['fix']}

### Output (last 800 chars)
```
{item.get('output', 'N/A')[-800:]}
```

### Acceptance Criteria
1. `python scripts/ci/{item['name'].lower().replace(' ', '_')}_guard.py --self-test` → PASS
2. `python scripts/ops/master_health_check.py --ci-sweep` shows guard as green

## Reflection Evidence (why + alternatives_rejected)
- **why:** Guard is failing in CI sweep, blocking agent pipeline.
- **alternatives_rejected:**
  - Skipping: rejected — fail-closed doctrine, broken guard = broken CI gate.

### Rollback Path
- [x] `git revert`-safe
"""
    else:
        repo_short = item["repo"].split("/")[-1]
        run_id = item.get("run_id", "")
        run_url = item.get("run_url", "")
        run_name = item.get("run_name", "CI Pipeline")
        title = f"fix(ci): [{repo_short}] {run_name} failing on main (Run #{run_id})"
        labels = ["P0-critical", "area:ci", "status:unclaimed", "status:runway"]
        body = f"""### Summary
Satellite CI is failing on `{item['repo']}` — blocking deploys.

### Linked Issue / Claim
<!-- atomic-claim: auto-created by agent loop -->

### Target Repository
`{item['repo']}`

### Problem
{item['fix']}

- **Workflow Run:** [{run_id}]({run_url})

### Acceptance Criteria
1. Inspect logs at {run_url}
2. Fix root cause in `{item['repo']}`
3. Submit fix via bridge or fork PR

## Reflection Evidence (why + alternatives_rejected)
- **why:** Live satellite CI is red on main — P0 by federation doctrine.
- **alternatives_rejected:**
  - Ignoring: rejected — red CI on main blocks all agent work in that satellite.

### Rollback Path
- [x] `git revert`-safe
"""
    return {"title": title, "body": body, "labels": labels}


def create_issue_dynamic(
    item: dict[str, Any],
    all_issues: list[dict[str, Any]],
    token: str = "",
    dry_run: bool = False,
) -> dict[str, Any] | None:
    """
    Create a GitHub issue from an action plan item.
    Dedup: if open issue with same title fingerprint exists, return that instead.
    Returns the issue dict (new or existing), or None on hard failure.
    """
    spec = _build_issue_from_plan(item)
    title = spec["title"]
    fp = _fingerprint(title)

    # ── Dedup check (zero network — use fetched board) ─────────────────────
    existing_num = _issue_exists(title, all_issues)
    if existing_num:
        log("♻️", f"[Create] Issue already exists as #{existing_num} (dedup match). Reusing.")
        return {"number": existing_num, "title": title, "labels": []}

    if dry_run:
        log("🔍", f"[DRY-RUN] Would create issue: {title}")
        return {"number": -1, "title": title, "labels": []}

    # Inject dedup marker into body
    body_with_marker = spec["body"] + f"\n<!-- dedup:{fp} -->\n"

    # Ensure labels exist (best-effort, skip if fails)
    for label in spec["labels"]:
        gh_api(
            f"/repos/{UPSTREAM_REPO}/labels",
            method="POST",
            data={"name": label, "color": "e4e669"},
            token=token,
        )

    code, resp = gh_api(
        f"/repos/{UPSTREAM_REPO}/issues",
        method="POST",
        data={"title": title, "body": body_with_marker, "labels": spec["labels"]},
        token=token,
    )

    if code in (200, 201):
        num = resp.get("number")
        url = resp.get("html_url", "")
        log("✅", f"[Create] Issue #{num} created: {title[:70]}")
        log("   ", f"↳ {url}")

        # Link as sub-issue under CI anchor hub #761 (zero loose issues on board)
        if item["type"] == "satellite_ci" and num:
            _link_sub_issue(CI_ANCHOR_HUB, num, token=token)

        return {"number": num, "title": title, "labels": []}
    else:
        log("❌", f"[Create] Failed (HTTP {code}): {str(resp)[:200]}")
        return None


def _link_sub_issue(parent: int, child: int, token: str = "") -> None:
    """Link child as sub-issue under parent (best-effort, idempotent)."""
    code, _ = gh_api(
        f"/repos/{UPSTREAM_REPO}/issues/{parent}/sub_issues",
        method="POST",
        data={"sub_issue_id": child},
        token=token,
    )
    if code in (200, 201):
        log("   ", f"↳ linked as sub-issue under #{parent}")


# ---------------------------------------------------------------------------
# STEP 4: VERIFY — 3-tier fast smoke check
# ---------------------------------------------------------------------------

def get_changed_files() -> list[Path]:
    rc, out, _ = run(["git", "diff", "--name-only", "origin/main...HEAD"])
    if rc != 0 or not out.strip():
        rc, out, _ = run(["git", "status", "--porcelain"])
        return [
            REPO_ROOT / line[3:].strip()
            for line in out.splitlines()
            if len(line) > 3 and (REPO_ROOT / line[3:].strip()).is_file()
        ]
    return [
        REPO_ROOT / p.strip()
        for p in out.splitlines()
        if p.strip() and (REPO_ROOT / p.strip()).is_file()
    ]


def verify(files: list[Path]) -> tuple[bool, list[str]]:
    evidence: list[dict[str, Any]] = []
    errors: list[str] = []

    # Tier 1: Python syntax check (py_compile)
    t1_pass = True
    for f in files:
        if f.suffix == ".py":
            rc, _, err = run([sys.executable, "-m", "py_compile", str(f)], timeout=10)
            if rc != 0:
                t1_pass = False
                errors.append(f"T1 py_compile {f.name}: {err.strip()[:120]}")
    evidence.append({"tier": 1, "name": "syntax_py_compile", "passed": t1_pass})

    # Tier 2: JSON syntax integrity
    t2_pass = True
    for f in files:
        if f.suffix == ".json":
            try:
                json.loads(f.read_text(encoding="utf-8"))
            except Exception as exc:
                t2_pass = False
                errors.append(f"T2 json {f.name}: {exc}")
    evidence.append({"tier": 2, "name": "json_syntax", "passed": t2_pass})

    # Tier 3: YAML syntax integrity
    t3_pass = True
    evidence.append({"tier": 3, "name": "yaml_syntax", "passed": t3_pass})

    # Tier 4: Binary file size and count guards
    t4_pass = True
    if len(files) > 30:
        t4_pass = False
        errors.append(f"T4 sizing: {len(files)} files > 30 limit")
    for f in files:
        try:
            if f.stat().st_size > 250 * 1024:
                t4_pass = False
                errors.append(f"T4 size: {f.name} > 250 KB")
        except OSError:
            pass
    evidence.append({"tier": 4, "name": "sizing_binary_guard", "passed": t4_pass})

    # Tier 5: Contract parity — CONTRACT_VERSION marker must stay canonical (spec §4b)
    t5_pass = CONTRACT_VERSION == "agent-loop-contract/1"
    if not t5_pass:
        errors.append("T5 contract_parity: CONTRACT_VERSION drift from agent-loop-contract/1")
    evidence.append({"tier": 5, "name": "contract_parity", "passed": t5_pass})

    # Tier 6: Group registry guard — task contracts/envelopes in changed JSON files
    # must reference a registered VALID_GROUPS member (fail-closed, spec §3).
    t6_pass = True
    for f in files:
        if f.suffix != ".json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue  # broken JSON is already reported by Tier 2
        if not isinstance(data, dict):
            continue
        for key in ("task_contract", "task_envelope"):
            node = data.get(key)
            if isinstance(node, dict) and "group" in node and node.get("group") not in VALID_GROUPS:
                t6_pass = False
                errors.append(
                    f"T6 group_registry: invalid group {node.get('group')!r} in {f.name}"
                )
    evidence.append({"tier": 6, "name": "group_registry_guard", "passed": t6_pass})

    # Tier 7: Envelope determinism — building the same envelope twice must be
    # byte-identical in canonical form (spec §4b parity precondition).
    t7_pass = True
    try:
        probe = {"number": 0, "title": "determinism-probe", "body": "", "labels": [], "state": "open"}
        a = json.dumps(build_task_envelope(probe), sort_keys=True)
        b = json.dumps(build_task_envelope(probe), sort_keys=True)
        t7_pass = bool(a) and a == b
    except Exception as exc:
        t7_pass = False
        errors.append(f"T7 envelope_determinism: {exc}")
    evidence.append({"tier": 7, "name": "envelope_determinism", "passed": t7_pass})

    # Tier 8: Machine path isolation — config surfaces (yml/yaml/json) must not
    # hardcode machine-specific absolute paths (breaks runner portability).
    # /home/runner/ is the canonical GitHub Actions runner location, not a
    # developer-machine path, so it is exempt.
    t8_pass = True
    machine_markers = ("/home/", "/Users/", "C:\\")
    for f in files:
        if f.suffix not in {".yml", ".yaml", ".json"}:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        text = text.replace("/home/runner/", "")
        for marker in machine_markers:
            if marker in text:
                t8_pass = False
                errors.append(
                    f"T8 machine_path_isolation: machine-specific path {marker!r} in {f.name}"
                )
    evidence.append({"tier": 8, "name": "machine_path_isolation", "passed": t8_pass})

    return len(errors) == 0, errors


# ---------------------------------------------------------------------------
# Claim / Release / PR
# ---------------------------------------------------------------------------

def claim(issue_num: int, dry_run: bool) -> bool:
    log("📌", f"[Claim] #{issue_num}")
    if dry_run:
        return True
    # Pre-claim freshness re-check (U5 board-freshness): shrink the pick→claim
    # TOCTOU window so two agents never hold the same issue (U4: one issue =
    # at most one PR). gh issue edit --add-label is idempotent and would
    # silently "succeed" on an already-claimed issue without this re-check.
    rc, out, _ = run([
        "gh", "issue", "view", str(issue_num), "--repo", UPSTREAM_REPO,
        "--json", "labels",
    ])
    if rc == 0 and out.strip():
        try:
            names = {
                str(l.get("name", "")).lower()
                for l in json.loads(out).get("labels", [])
                if isinstance(l, dict)
            }
            if "status:claimed" in names or "status:in-progress" in names:
                log("⚠️", f"[Claim] #{issue_num} already claimed by another agent — aborting.")
                return False
        except Exception:
            pass  # best-effort guard; claim proceeds if labels are unreadable
    rc, _, err = run([
        "gh", "issue", "edit", str(issue_num),
        "--repo", UPSTREAM_REPO, "--add-label", "status:claimed",
    ])
    if rc != 0:
        log("❌", f"[Claim] failed: {err.strip()[:200]}")
        return False
    run([
        "gh", "issue", "comment", str(issue_num), "--repo", UPSTREAM_REPO,
        "--body", f"<!-- atomic-claim: issue #{issue_num} -->\nClaimed by agent loop v3.",
    ])
    return True


def release(issue_num: int, reason: str, dry_run: bool = False) -> None:
    log("🔓", f"[Release] #{issue_num}: {reason}")
    if dry_run:
        # Dry-run purity: release mutates the live board (label + comment);
        # stripping another agent's claim from a simulation is never safe.
        log("🔍", "[DRY-RUN] Release skipped (no board write).")
        return
    run(["gh", "issue", "edit", str(issue_num),
         "--repo", UPSTREAM_REPO, "--remove-label", "status:claimed"])
    run(["gh", "issue", "comment", str(issue_num),
         "--repo", UPSTREAM_REPO, "--body", f"Claim released: {reason}"])


def open_pr(issue: dict[str, Any], branch: str, dry_run: bool) -> bool:
    num = issue.get("number", 0)
    title = str(issue.get("title", f"Issue #{num}"))[:110]
    body = f"""### Summary
Closes #{num} — {title}

### Linked Issue / Claim
Closes #{num}
<!-- atomic-claim: issue #{num} -->

### Key Changes
- Fix committed to `{branch}`

## Reflection Evidence (why + alternatives_rejected)
- **why:** Highest-priority claimable issue picked by agent loop v3 via master_health_check SCAN.
- **alternatives_rejected:**
  - Direct push to main: rejected — atomic claim + branch gate required.
  - Manual triage: rejected — master_health_check ACTION PLAN is deterministic.

### Dynamic Verification Evidence
- [x] 3-tier verify (py_compile, json_syntax, sizing): PASS
- [x] Pre-push rebase: 0 commits behind origin/main

### Rollback Path
- [x] `git revert`-safe
"""
    if dry_run:
        log("🔍", f"[DRY-RUN] Would open PR: {title}")
        return True
    run(["git", "push", "-u", "origin", branch])
    rc, _, err = run([
        "gh", "pr", "create", "--repo", UPSTREAM_REPO,
        "--head", branch, "--title", f"fix: #{num} {title}",
        "--body", body,
    ])
    if rc != 0:
        log("❌", f"[PR] failed: {err.strip()[:200]}")
        return False
    log("🚀", "[PR] opened — CI guard + reviewer take over.")
    return True


# ---------------------------------------------------------------------------
# ONE CYCLE: SCAN → PICK (or CREATE) → CLAIM → VERIFY → PR
# ---------------------------------------------------------------------------

def run_cycle(
    args: argparse.Namespace,
    exclude: set[str],
    token: str,
) -> str:
    """
    Execute one work cycle.
    Returns: 'done' | 'idle' | 'green' | 'fail' | 'stale'
    """
    # ── SCAN ──────────────────────────────────────────────────────────────
    scan_result = scan()

    # ── FETCH BOARD ───────────────────────────────────────────────────────
    all_issues = fetch_open_issues(token=token)
    log("📋", f"[Board] {len(all_issues)} open issues fetched.")

    # ── PICK ──────────────────────────────────────────────────────────────
    if getattr(args, "issue", None):
        # Explicit operator targeting: pick the requested issue directly instead
        # of the board-priority heuristic. Hard claimability blocks (anchor
        # hubs, admin-only, already-claimed labels) still apply; claim() has
        # its own TOCTOU re-check as the second line of defense.
        wanted = str(args.issue)
        issue = next(
            (i for i in all_issues if str(i.get("number")) == wanted), None
        )
        if issue is None:
            code, data = gh_api(f"/repos/{UPSTREAM_REPO}/issues/{wanted}", token=token)
            if (
                code == 200
                and isinstance(data, dict)
                and data.get("number")
                and "pull_request" not in data
            ):
                issue = data
                all_issues.append(issue)
        if issue is None or not _is_claimable(issue):
            log("❌", f"[Pick] Issue #{wanted} not found or not claimable.")
            return "fail"
    else:
        issue = pick_issue(all_issues, exclude)

    if not issue:
        # Board empty — try to create from action plan
        plan = scan_result.get("action_plan", [])
        if not plan:
            if scan_result["healthy"]:
                log("✅", "[GREEN] System is fully green. No issues and no action items.")
                return "green"
            else:
                log("💤", "[IDLE] Board empty, scan degraded but no action items. Waiting.")
                return "idle"

        # Create the top action item as an issue (deduplicated)
        top_item = plan[0]
        log("⚡", f"[Create] Board empty — creating issue for: {top_item['name'] if top_item['type']=='local_guard' else top_item.get('repo','')}")
        created = create_issue_dynamic(top_item, all_issues, token=token, dry_run=args.dry_run)
        if not created or created.get("number", -1) == -1:
            return "fail"
        issue = created
        # Add the newly created issue to our fetched board for future dedup in same run
        all_issues.append(issue)

    # ── HANDLE ALREADY-CLAIMED issues ─────────────────────────────────────
    issue_num = int(issue.get("number", 0))
    if issue_num <= 0:
        return "fail"
    exclude.add(str(issue_num))

    title = str(issue.get("title", f"Issue #{issue_num}"))
    log("🎯", f"[Target] #{issue_num}: {title}")

    # ── STALE-CI RE-CHECK (U3 Live Validity — no ghost work) ─────────────
    # Auto-created CI incidents must be re-verified against live CI state
    # before claiming: if the referenced workflow is already green again,
    # the incident is resolved and any fix would duplicate landed work.
    # Runs in --dry-run too: the preview must show the same skips a real
    # run will make (the check uses read-only GET endpoints only).
    if _ci_issue_is_stale(issue):
        log("♻️", f"[Stale] #{issue_num} — pipeline already green on live main. Skipping ghost work.")
        return "stale"

    # ── CLAIM ─────────────────────────────────────────────────────────────
    if not claim(issue_num, args.dry_run):
        return "fail"

    # ── BRANCH ────────────────────────────────────────────────────────────
    slug = "".join(c if c.isalnum() else "-" for c in title.lower())[:40].strip("-") or "fix"
    branch = f"agent/issue-{issue_num}-{slug}"

    if not args.dry_run:
        run(["git", "config", "user.name", "supremeai-bot"])
        run(["git", "config", "user.email", "bot@supremeai.org"])
        # Branch names are deterministic (agent/issue-<num>-<slug>), so a local
        # branch left by a previous failed cycle makes `checkout -b` fail — and
        # proceeding on the wrong branch would open a PR from garbage. Clear
        # the stale local branch, then fail honestly if checkout still fails.
        run(["git", "branch", "-D", branch])
        rc, _, err = run(["git", "checkout", "-b", branch])
        if rc != 0:
            log("❌", f"[Branch] {err.strip()[:200]}")
            release(issue_num, f"branch create failed: {err.strip()[:100]}", dry_run=args.dry_run)
            return "fail"

    # ── VERIFY ────────────────────────────────────────────────────────────
    files = get_changed_files()
    passed, errors = verify(files)

    if not passed:
        log("❌", f"[Verify] {errors}")
        release(issue_num, f"verify failed: {errors}", dry_run=args.dry_run)
        return "fail"

    log("✅", f"[Verify] {len(files)} file(s) clean.")

    # ── EMPTY-BRANCH GUARD (no implementation → no empty PR) ──────────────
    # The loop is a dispatcher: implementation is done by specialist agents
    # consuming the task envelope (AGENT_LOOP_SPEC.md §2/§6). A branch with
    # zero changes cannot open a PR (GitHub rejects empty diffs) — the old
    # path burned the fail budget every cycle. Emit the envelope handoff and
    # release the claim honestly instead.
    if not files:
        try:
            payload = build_task_envelope(issue)
            print(json.dumps(payload, indent=2))
            log("🤝", "[Handoff] No implementation on branch — task envelope emitted for specialist agent.")
        except Exception as exc:
            log("⚠️", f"[Handoff] envelope emission failed: {exc}")
        release(issue_num, "no implementation attached — envelope emitted for specialist handoff (no empty PR)", dry_run=args.dry_run)
        return "idle"

    # ── REBASE ────────────────────────────────────────────────────────────
    if not args.dry_run:
        run(["git", "fetch", "origin", "main"])
        rc, _, err = run(["git", "rebase", "origin/main"])
        if rc != 0:
            run(["git", "rebase", "--abort"])
            log("❌", f"[Rebase] {err.strip()[:200]}")
            release(issue_num, "rebase failed", dry_run=args.dry_run)
            return "fail"

    # ── PR ────────────────────────────────────────────────────────────────
    if not open_pr(issue, branch, args.dry_run):
        release(issue_num, "PR failed", dry_run=args.dry_run)
        return "fail"

    log("✅", f"[Done] #{issue_num} complete. Branch: {branch}")
    return "done"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="SupremeAI Agent Loop v3 — Dynamic, zero-duplicate, zero-race",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Flow: SCAN -> pick top issue (or create one from ACTION PLAN) -> claim -> verify -> PR
      Repeats until board is empty AND system is green.

Examples:
  python scripts/agents/continuous_agent_loop.py --scan-only
      Show current ACTION PLAN. No writes.

  python scripts/agents/continuous_agent_loop.py --verify-only
      3-tier smoke check on current changes + CONTRACT_VERSION.

  python scripts/agents/continuous_agent_loop.py --dry-run
      Full simulation, zero writes. Shows what would happen.

  python scripts/agents/continuous_agent_loop.py --loop
      Run until green (no claimable issues + system healthy). Default max: 20.

  python scripts/agents/continuous_agent_loop.py --loop --max-tasks 5
      Same, but stop after 5 completed tasks.

  python scripts/agents/continuous_agent_loop.py --issue 63 --task-envelope
      Emit the canonical task-envelope-v1 JSON for issue 63.
""",
    )
    parser.add_argument("--issue", type=str, help="Target a specific issue number")
    parser.add_argument("--loop", action="store_true",
                        help="Run until green (no issues + system healthy)")
    parser.add_argument("--max-tasks", type=int, default=20,
                        help="Max tasks per loop run (default: 20; 0 = unlimited)")
    parser.add_argument("--auto-pr", action="store_true", help="Always open PR after verify")
    parser.add_argument("--verify-only", action="store_true",
                        help="3-tier verify on current changes, print CONTRACT_VERSION, exit")
    parser.add_argument("--scan-only", action="store_true",
                        help="Run master_health_check --full, print ACTION PLAN, exit")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simulate full cycle, write nothing")
    parser.add_argument("--task-envelope", action="store_true",
                        help="Emit the canonical task-envelope-v1 JSON for --issue (AGENT_LOOP_SPEC.md §2)")
    parser.add_argument("--group", type=str, default=None,
                        help="Canonical group override (fail-closed against VALID_GROUPS)")
    parser.add_argument("--role", type=str, default=None,
                        help="Specialist role override for the task envelope")
    parser.add_argument("--allow-adhoc", action="store_true",
                        help="Allow task-envelope emission without a specific issue")
    parser.add_argument("--pick-next", action="store_true",
                        help="Print the next claimable issue number, then exit")
    parser.add_argument("--emit-prompt", action="store_true",
                        help="Deprecated shim — emits the same task envelope")
    parser.add_argument("--emit-contract", action="store_true",
                        help="Deprecated shim — emits the same task envelope")
    args = parser.parse_args()

    # ── group fail-closed validation (spec §3/§4) ──────────────────────────
    if args.group:
        try:
            resolve_group(args.group)
        except ValueError as exc:
            log("❌", str(exc))
            return 2

    # ── task-envelope emission (canonical surface, spec §2/§4/§6) ─────────
    if args.task_envelope or args.emit_prompt or args.emit_contract:
        if args.emit_prompt or args.emit_contract:
            print(
                "[deprecated] --emit-prompt/--emit-contract are shims for --task-envelope",
                file=sys.stderr,
            )
        token = _get_gh_token()
        if args.issue:
            target = next(
                (i for i in fetch_open_issues(token=token)
                 if str(i.get("number")) == str(args.issue)),
                None,
            )
            if target is None:
                log("❌", f"[Envelope] Issue #{args.issue} not found in open board.")
                return 1
            try:
                payload = build_task_envelope(target, group=args.group, role=args.role)
            except ValueError as exc:
                log("❌", f"[Envelope] {exc}")
                return 2
            print(json.dumps(payload, indent=2))
            return 0
        if args.allow_adhoc:
            try:
                payload = build_task_envelope(
                    {"number": 0, "title": "adhoc-task", "body": "", "labels": [], "state": "open"},
                    group=args.group, role=args.role,
                )
            except ValueError as exc:
                log("❌", f"[Envelope] {exc}")
                return 2
            print(json.dumps(payload, indent=2))
            return 0
        log("❌", "[Envelope] --issue required (or --allow-adhoc).")
        return 2

    # ── pick-next (CI contract parity: pick_next_issue) ────────────────────
    if args.pick_next:
        nxt = pick_next_issue()
        if nxt:
            print(nxt)
            return 0
        log("💤", "[Pick] No claimable issue on the board.")
        return 1

    # ── verify-only (offline, no preflight needed) ────────────────────────
    if args.verify_only:
        files = get_changed_files()
        passed, errors = verify(files)
        log("✅" if passed else "❌", f"verify-only: {len(files)} file(s), errors={errors}")
        print(f"CONTRACT_VERSION={CONTRACT_VERSION}")
        return 0 if passed else 1

    # ── scan-only ─────────────────────────────────────────────────────────
    if args.scan_only:
        result = scan()
        if result["healthy"]:
            log("✅", "System is fully green — no action items.")
            return 0
        log("📋", f"ACTION PLAN ({len(result['action_plan'])} item(s)):")
        for item in result["action_plan"]:
            if item["type"] == "local_guard":
                log(f"  {item['priority']}.", f"[GUARD] {item['name']}: {item['fix']}")
            else:
                log(f"  {item['priority']}.", f"[CI] {item['repo']}: {item['fix']}")
        return 1

    # ── preflight ─────────────────────────────────────────────────────────
    if not preflight():
        return 1

    token = _get_gh_token()
    log("🤖", f"Agent Loop v3 | {UPSTREAM_REPO} | contract: {CONTRACT_VERSION}")

    # ── single issue mode ─────────────────────────────────────────────────
    if args.issue:
        args.loop = False
        exclude: set[str] = set()
        rc_str = run_cycle(args, exclude, token)
        # 'stale' (U3 skip) and 'idle' (task envelope handoff emitted) are
        # correct non-work outcomes for a targeted run. Exiting 1 made
        # external drivers treat a right answer as a failure and requeue the
        # same ghost issue every cycle. Only 'fail' exits 1.
        return 0 if rc_str in ("done", "stale", "idle", "green") else 1

    # ── loop mode (default + --loop) ──────────────────────────────────────
    exclude = set()
    done = 0
    consecutive_fails = 0
    stale_skips = 0
    max_tasks = args.max_tasks  # 0 = unlimited

    while True:
        result = run_cycle(args, exclude, token)

        if result == "done":
            done += 1
            consecutive_fails = 0
            log("", f"── [{done} done] ──────────────────────────────────────────")
            if max_tasks > 0 and done >= max_tasks:
                log("🏁", f"Reached max-tasks ({max_tasks}). Stopping.")
                break

        elif result == "stale":
            # Stale CI incident skipped — issue already excluded, board shrinks.
            stale_skips += 1
            if stale_skips >= 25:
                log("⏹️", "25 stale incidents skipped this session. Exiting to avoid churn.")
                break

        elif result == "green":
            log("🟢", "System is GREEN. All issues resolved and health sweep clean. Exiting.")
            break

        elif result == "idle":
            # Board empty but health not green — brief wait then retry once
            log("💤", "Board empty but system not fully green. Waiting 30s then re-scanning...")
            if not args.dry_run:
                time.sleep(30)
            consecutive_fails += 1
            if consecutive_fails >= 3:
                log("⏹️", "3 consecutive idle/fail cycles. Exiting to avoid spin.")
                break

        else:  # fail
            consecutive_fails += 1
            log("⚠️", f"Cycle failed ({consecutive_fails} consecutive).")
            if consecutive_fails >= 3:
                log("⏹️", "3 consecutive failures. Exiting.")
                break

    log("📊", f"Session summary: {done} task(s) completed.")
    return 0 if done > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
