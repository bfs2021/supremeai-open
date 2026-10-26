# Fix for #1333 client streaming/retry r4: land the fixed root shared-services client via unified diff (streamChatMessage + requestWithRetry + 120s timeout + typed ApiError)

Work order: `bridge-20261027-fix-1333-client-streaming-r4` — lands the r3 implementation (tsc 5.9.3-verified, order #1419) directly into the existing root client using the bridge's documented `unified_diff` ingress, instead of the new-file-plus-manual-swap lane whose PR (#1420) closed unmerged without a verdict.

## Problem (unchanged from #1333)
The ROOT `packages/shared-services/src/services/SupremeAIService.ts` consumer path (VS Code extension via `workspace:^`) still ships the pre-fix client: no token streaming (users stare at a blank panel for the whole generation), no retry on transient failures, a hard 10s timeout that truncates long completions, and errors swallowed into generic rejections. The studio-nested copy already carries the landed fix; the root file on monorepo main (sha `b6cfa2e5`, verified identical to the r3 base before diffing) still has zero occurrences of the streaming/retry symbols.

## What this order does
Applies one unified diff against the branch tip of
`packages/shared-services/src/services/SupremeAIService.ts` that replaces the client body with the r3 implementation: `streamChatMessage` via fetch + ReadableStream SSE parsing, `requestWithRetry` (2 retries, exponential backoff + jitter), 120s configurable timeout, typed `ApiError` with status/requestId context. Content-only diff: no file-mode change.

## Verification evidence
- `git apply --check` CLEAN against a tree seeded with the current main content (sha b6cfa2e5)
- Post-apply file is byte-identical to the r3 implementation previously verified with tsc 5.9.3
- Diff base equality asserted: current main content == r3 base content, so context matching is fail-closed safe

## Acceptance criteria
- [x] Root client exposes streaming message API (ReadableStream consumption)
- [x] Transient failures retried twice with exponential backoff + jitter
- [x] Timeout configurable, default 120s (no more 10s truncation)
- [x] Typed error surface (status, requestId) instead of swallowed rejections
- [x] No API surface break: existing method names/exports preserved (diff is body-level)

## Rollback
`git revert` the single commit on the patch branch; the base file content (sha b6cfa2e5) is recoverable from main history.
