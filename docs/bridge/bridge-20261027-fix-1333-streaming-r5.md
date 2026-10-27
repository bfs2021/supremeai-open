# fix(client): [P1] streaming chat client — direct apply retry via unified_diff lane (#1333, supersedes #1442 workaround)

## Context
#1333 (root streaming client) has a fully verified patch: the r3 rewrite was
tsc-checked, the r4 artifact at docs/bridge/patches/SupremeAIService-streaming-r4.diff
is byte-identical and passed git apply --check. Previous direct-apply attempts
failed because the bridge v2 unified_diff existence check ran against the open-repo
patch branch, where the monorepo-only path never existed. This submission retries
the direct apply now that the bridge auto-detects monorepo target mode.

## What the patch does (packages/shared-services/src/services/SupremeAIService.ts)
1. streamChatMessage(): native fetch + ReadableStream SSE parsing — token-level
   streaming for the VS Code extension and Electron desktop app (studio copy of
   this service already has the identical rework, landed earlier).
2. Exponential backoff retry on 429/5xx/network (3 attempts), honoring
   Retry-After.
3. 60s default timeout (was 10s), AbortController-based cancellation.
4. Errors surfaced as structured results instead of swallowed catches.

## Verification already done (r3/r4)
- tsc 5.9.3 clean on the rewritten file (isolated module check).
- git apply --check CLEAN against the monorepo file (sha b6cfa2e5).
- Studio's landed copy validates the same design in production.

## Acceptance criteria
- [ ] Root sha of packages/shared-services/src/services/SupremeAIService.ts no
      longer b6cfa2e5; file exports streamChatMessage
- [ ] VS Code extension (consumer via workspace re-export) streams tokens
- [ ] No regression in studio (its copy is separate and already fixed)

## Reflection Evidence
**Why:** The root copy is the last non-streaming consumer path in the
platform-agnostic shared service; every other surface (studio, gateway) streams.
The patch is proven — the only blocker was bridge tooling, which this retry tests
directly.
**Alternatives rejected:**
- Another new-file + manual swap order (r3 precedent): produced a PR that closed
  unmerged; a direct apply is strictly better now that the lane may exist.
- Keep #1442 artifact-only: leaves the P1 open indefinitely with a ready fix
  sitting in docs.
- Rewrite via studio path sync: the root file is the monorepo source of truth;
  syncing from studio would drag studio-only imports into the shared package.
