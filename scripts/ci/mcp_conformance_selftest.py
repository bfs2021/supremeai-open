#!/usr/bin/env python3
"""MCP conformance self-test (#1329) — bridge-20261027-tower-self-capability.

Asserts that everything the tower ADVERTISES is actually usable:
  1. resources/list  -> every advertised URI is readable (no -32602).
  2. codebase_graph_query("chat") -> returns symbols (graph.json reachable).
  3. devtools_audit -> never reports verdict PASS while mode is a fallback.

Usage (CI or local):
  python scripts/ci/mcp_conformance_selftest.py [--url https://supremeai-mcp-tower.onrender.com/mcp]

Exit codes: 0 = conformant, 1 = violations found, 2 = tower unreachable.
Stdlib-only so it can run in any CI lane.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://supremeai-mcp-tower.onrender.com/mcp"
HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


def post(url: str, payload: dict, session_id: str | None = None, timeout: int = 60):
    headers = dict(HEADERS)
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        sid = resp.headers.get("mcp-session-id", session_id)
        raw = resp.read().decode("utf-8", errors="replace")
        payloads = []
        if raw.lstrip().startswith("event:") or "\ndata:" in raw:
            for line in raw.splitlines():
                if line.startswith("data:"):
                    try:
                        payloads.append(json.loads(line[5:].strip()))
                    except json.JSONDecodeError:
                        pass
        else:
            payloads.append(json.loads(raw))
        return sid, payloads


def initialize(url: str) -> str:
    sid, resps = post(url, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                   "clientInfo": {"name": "mcp-conformance-selftest", "version": "1.0"}},
    })
    post(url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    return sid


def rpc(url: str, sid: str, method: str, params: dict, rid: int = 10):
    _, resps = post(url, {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}, sid)
    return resps[0] if resps else {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    args = ap.parse_args()
    url = args.url

    try:
        sid = initialize(url)
    except Exception as err:  # noqa: BLE001
        print(f"FATAL: cannot initialize session with {url}: {err}")
        return 2

    violations: list[str] = []

    # ---- 1. every advertised resource must be readable ----
    listing = rpc(url, sid, "resources/list", {}, rid=11)
    uris = [r.get("uri") for r in listing.get("result", {}).get("resources", [])]
    print(f"resources/list: {len(uris)} advertised")
    for uri in uris:
        res = rpc(url, sid, "resources/read", {"uri": uri}, rid=12)
        if "error" in res:
            violations.append(f"resource {uri} -> JSON-RPC {res['error'].get('code')}: {res['error'].get('message')}")
    print(f"resources/read: {len(uris) - len(violations)}/{len(uris)} readable")

    # ---- 2. codebase graph must be queryable ----
    call = rpc(url, sid, "tools/call", {"name": "codebase_graph_query", "arguments": {"query": "chat"}}, rid=13)
    if "error" in call:
        violations.append(f"codebase_graph_query errored: {call['error']}")
    else:
        text = json.dumps(call.get("result", {}))
        if "not found" in text.lower() or "not_indexed" in text.lower():
            violations.append("codebase_graph_query('chat') returned not-indexed — graph.json missing from tower read path")

    # ---- 3. audit tool must never PASS in fallback mode ----
    call = rpc(url, sid, "tools/call",
               {"name": "devtools_audit", "arguments": {"url": "https://supremeai-studio.pages.dev", "device": "desktop"}}, rid=14)
    text = json.dumps(call.get("result", {}))
    if "http-diagnostic-fallback" in text and '"PASS"' in text:
        violations.append("devtools_audit reported PASS while in http-diagnostic-fallback mode (dishonest verdict)")

    print("\n=== CONFORMANCE REPORT ===")
    if violations:
        for v in violations:
            print(f"VIOLATION: {v}")
        return 1
    print("OK: all advertised capabilities are actually usable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
