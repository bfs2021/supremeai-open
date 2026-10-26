import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

interface GraphNode {
  id: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
  _callable?: boolean;
  [key: string]: unknown;
}

interface GraphLink {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  source_file?: string;
  source_location?: string;
  [key: string]: unknown;
}

interface GraphData {
  nodes?: GraphNode[];
  links?: GraphLink[];
  edges?: GraphLink[];
}

function findGraphJson(): string | null {
  const candidatePaths = [
    path.join(REPO_ROOT, ".cache", "graphify-full", "graphify-out", "graph.json"),
    path.join(REPO_ROOT, ".cache", "graphify", "studio", "graphify-out", "graph.json"),
    path.join(REPO_ROOT, "graphify-out", "graph.json"),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * SupremeAI Intelligence & Diagnostics Tools.
 * Exposes:
 *  1. codebase_graph_query — deterministic AST knowledge graph search (Graphify).
 *  2. devtools_audit — browser diagnostic audit for web targets (Playwright/HTTP).
 */
export async function registerIntelligenceTools(server: McpServer): Promise<void> {
  // ── 1. Codebase Graph Query (Graphify AST Engine)
  server.tool(
    "codebase_graph_query",
    "Search SupremeAI's AST knowledge graph across the federation repositories (Graphify). Returns matched symbols, classes, functions, line numbers, and connected caller/callee relations without LLM hallucination.",
    {
      query: z.string().describe("Symbol, function name, class, endpoint route, or file to search, e.g. 'studio_auth_login' or 'GuestChat'"),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum matched nodes to return (default: 15)"),
    },
    async ({ query, limit }) => {
      try {
        const graphPath = findGraphJson();
        if (!graphPath) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "graph.json not found. Run 'graphify extract .' or 'python scripts/ci/sync_graph_to_memory.py' first.",
                    status: "not_indexed",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const raw = fs.readFileSync(graphPath, "utf-8");
        const graph: GraphData = JSON.parse(raw);
        const qLower = query.toLowerCase();

        const allNodes = graph.nodes || [];
        const matchedNodes: GraphNode[] = [];
        for (const n of allNodes) {
          const lbl = String(n.label || "").toLowerCase();
          const nid = String(n.id || "").toLowerCase();
          const src = String(n.source_file || "").toLowerCase();
          if (lbl.includes(qLower) || nid.includes(qLower) || src.includes(qLower)) {
            matchedNodes.push(n);
          }
        }

        const maxNodes = limit ?? 15;
        const slicedNodes = matchedNodes.slice(0, maxNodes);
        const matchedIds = new Set(slicedNodes.map((n) => n.id));

        const allLinks = graph.links || graph.edges || [];
        const connectedLinks: GraphLink[] = [];
        for (const l of allLinks) {
          if (matchedIds.has(l.source) || matchedIds.has(l.target)) {
            connectedLinks.push(l);
            if (connectedLinks.length >= 30) break;
          }
        }

        const result = {
          query,
          graphSource: path.relative(REPO_ROOT, graphPath),
          totalMatches: matchedNodes.length,
          returnedNodes: slicedNodes.length,
          nodes: slicedNodes.map((n) => ({
            id: n.id,
            label: n.label,
            source_file: n.source_file,
            source_location: n.source_location,
            community: n.community,
            callable: n._callable ?? false,
          })),
          connections: connectedLinks.map((l) => ({
            source: l.source,
            target: l.target,
            relation: l.relation || "relates_to",
            location: l.source_file ? `${l.source_file}:${l.source_location || ""}` : undefined,
          })),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error: ${(err as Error).message}` }] };
      }
    }
  );

  // ── 2. DevTools Audit Tool (Browser Diagnostics Engine)
  server.tool(
    "devtools_audit",
    "Audit a target web page (frontend, landing, or customer URL). Uses SupremeAI browser diagnostics to collect console errors, failing network requests, HTTP status, security headers, and accessibility violations.",
    {
      url: z.string().url().describe("Target URL to audit, e.g. 'https://example.com'"),
      device: z.enum(["desktop", "mobile"]).optional().describe("Device viewport profile (default: desktop)"),
    },
    async ({ url, device }) => {
      try {
        const auditScript = path.join(REPO_ROOT, ".agents", "skills", "devtools-audit", "scripts", "audit.mjs");
        const reportScript = path.join(REPO_ROOT, ".agents", "skills", "devtools-audit", "scripts", "build_report.py");

        if (fs.existsSync(auditScript) && fs.existsSync(reportScript)) {
          const tempOutDir = path.join(REPO_ROOT, ".cache", "audit-temp");
          let auditFallbackReason: string | undefined;
          fs.mkdirSync(tempOutDir, { recursive: true });
          const rawPath = path.join(tempOutDir, "temp_audit.raw.json");

          try {
            await execFileAsync("node", [
              auditScript,
              url,
              "--out",
              rawPath,
              "--device",
              device || "desktop",
              "--timeout",
              "20000",
            ]);

            await execFileAsync("python", [
              reportScript,
              rawPath,
              "--out-dir",
              tempOutDir,
              "--label",
              new URL(url).hostname,
            ]);

            const reportJsonPath = path.join(tempOutDir, "report.json");
            if (fs.existsSync(reportJsonPath)) {
              const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf-8"));
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        target: url,
                        device: device || "desktop",
                        verdict: report.verdict,
                        counts: report.counts,
                        metrics: report.metrics,
                        findingsTop: (report.findings || []).slice(0, 5),
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
          } catch (auditErr) {
            // bridge-20261027-tower-self-capability (#1329): the silent catch
            # made fallback audits indistinguishable from real ones. Capture
            # the reason and carry it into the fallback result below.
            auditFallbackReason = `browser audit execution failed: ${(auditErr as Error)?.message ?? String(auditErr)}`;
            // Fall through to fast HTTP diagnostics if browser execution errors
          }
        }

        // Fast HTTP diagnostics fallback (guaranteed offline/minimal mode)
        const start = Date.now();
        const resp = await fetch(url, { headers: { "User-Agent": "SupremeAI-DevTools-Audit/1.0" } });
        const latencyMs = Date.now() - start;
        const headers = Object.fromEntries(resp.headers.entries());

        const secHeaders = {
          strictTransportSecurity: !!headers["strict-transport-security"],
          contentSecurityPolicy: !!headers["content-security-policy"],
          xFrameOptions: !!headers["x-frame-options"],
          xContentTypeOptions: !!headers["x-content-type-options"],
        };

        const result = {
          target: url,
          mode: "http-diagnostic-fallback",
          degraded: true,
          fallbackReason: auditFallbackReason ?? "browser audit path unavailable — only HTTP-level checks ran",
          status: resp.status,
          latencyMs,
          securityHeaders: secHeaders,
          // (#1329): never claim PASS from fallback mode — no console errors,
          // no failed requests, no a11y checks actually ran.
          verdict: resp.ok ? "INCOMPLETE" : "FAIL",
          summary: `HTTP ${resp.status} received in ${latencyMs}ms. HSTS: ${secHeaders.strictTransportSecurity ? "OK" : "MISSING"}, CSP: ${secHeaders.contentSecurityPolicy ? "OK" : "MISSING"}. Browser-level checks did NOT run${auditFallbackReason ? `: ${auditFallbackReason}` : ""}.`,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Audit error: ${(err as Error).message}` }] };
      }
    }
  );
}
