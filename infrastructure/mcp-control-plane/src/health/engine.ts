import { globalHealthCache, HealthSnapshot } from "./snapshot.js";
import { globalIncidentEngine, IncidentAlert } from "./incident.js";
import { globalDependencyGraph } from "./dependency.js";
import { globalHealthHistoryStore } from "./history.js";
import { env } from "../lib/env.js";

const CHECK_TIMEOUT_MS = 15000;

// Import all adapter checks
import { getServiceHealth } from "../adapters/render/index.js";
import { getHealth as getSupabaseHealth } from "../adapters/supabase/index.js";
import { pingRedis } from "../adapters/redis/index.js";
import { getWorkerStatus } from "../adapters/cloudflare/index.js";
import { auditSecrets } from "../adapters/infisical/index.js";
import { checkStripe, checkVercel, checkFirecrawl, checkKaggle, checkQdrant } from "../adapters/misc/index.js";
import { testProvider, listProviders } from "../adapters/ai/index.js";
import { checkTelegram } from "../adapters/notify/index.js";

export interface SweepReport {
  timestamp: string;
  durationMs: number;
  incidents: IncidentAlert[];
  snapshots: Record<string, HealthSnapshot>;
  dependencyImpact: Record<string, string[]>;
  overallStatus: "healthy" | "degraded" | "down" | "unknown";
}

export class HealthEngine {
  private maxConsecutiveFailuresBeforeCircuitOpen = 3;

  /**
   * Executes a single health check with circuit breaker logic.
   */
  private async executeCheck(
    provider: string,
    checkFn: () => Promise<any>
  ): Promise<HealthSnapshot> {
    const oldSnap = globalHealthCache.getSnapshot(provider);
    
    // Check Circuit Breaker
    if (oldSnap && oldSnap.status === "circuit_open") {
      // Very simple circuit breaker: stays open until manually reset or TTL expires (handled elsewhere)
      // For now, we will attempt a half-open probe.
      console.log(`[HealthEngine] Circuit breaker half-open for ${provider}. Attempting probe...`);
    }

    const started = Date.now();
    try {
      const data = await Promise.race([
        checkFn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("health check timeout")), CHECK_TIMEOUT_MS)),
      ]);
      const status = data && typeof data === "object" && ["degraded", "down", "unknown"].includes(String((data as any).status))
        ? (String((data as any).status) as HealthSnapshot["status"]) : "healthy";
      return {
        provider, status, lastCheckMs: Date.now(), checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started, consecutiveFailures: status === "healthy" ? 0 : (oldSnap?.consecutiveFailures || 0) + 1,
        evidence: { kind: "provider_response", summary: `Provider check returned ${status}` },
        impactedServices: globalDependencyGraph.getImpactedServices(provider), data,
      };
    } catch (err: any) {
      const consecutiveFailures = (oldSnap?.consecutiveFailures || 0) + 1;
      const timedOut = String(err?.message).includes("timeout");
      const status = consecutiveFailures >= this.maxConsecutiveFailuresBeforeCircuitOpen ? "circuit_open" : "down";
      return {
        provider, status, lastCheckMs: Date.now(), checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started, consecutiveFailures,
        evidence: { kind: timedOut ? "timeout" : "error", summary: timedOut ? "Provider check timed out" : "Provider check failed" },
        impactedServices: globalDependencyGraph.getImpactedServices(provider), error: err?.message || "Unknown error",
      };
    }
  }

  /**
   * Runs a full parallel sweep of all configured providers.
   * Caches results and generates incidents.
   */
  public async runFullSweep(): Promise<SweepReport> {
    const start = Date.now();
    const incidents: IncidentAlert[] = [];
    
    // Define all providers and their check functions
    // #4091 topology hygiene: hardcoded srv- fallback removed — serviceId must
    // come from env config. Missing ID fails THIS provider honestly (incident
    // হিসেবে ধরা পড়বে), বাকি providers স্বাভাবিক sweep চালিয়ে যাবে।
    const checks: Record<string, () => Promise<any>> = {
      "render": async () => {
        const serviceId = env.render.primary.serviceId;
        if (!serviceId) {
          throw new Error("env.render.primary.serviceId is not configured — hardcoded fallback removed (#4091 topology hygiene)");
        }
        const data: any = await getServiceHealth("render-primary", serviceId);
        // #110 Part 3: deploy-status cross-reference. The adapter only returns
        // {service, lastDeployStatus} — no `status` field — so the engine's
        // generic mapping used to call a build_failed deploy "healthy".
        // বাংলা মন্তব্য: সর্বশেষ ডিপ্লয় ব্যর্থ হলে (build_failed/pre_deploy_failed)
        // সার্ভিসকে এখন সৎভাবে degraded হিসেবে চিহ্নিত করা হয় — মিথ্যে healthy নয়।
        const deployStatus = String(data?.lastDeployStatus ?? "").toLowerCase();
        const deployDerived =
          deployStatus === "build_failed" || deployStatus === "pre_deploy_failed" || deployStatus === "canceled"
            ? "degraded"
            : deployStatus === "deploy_failed" || deployStatus === "deactivated" || deployStatus === "crashed"
              ? "down"
              : undefined;
        if (deployDerived) {
          // bridge-20261027-frontend-observability (#1335): a failed LAST deploy
          // is pipeline news, not necessarily service news. When the service
          // object reports the deployment as live, keep the service honestly
          // healthy but carry the pipeline failure as structured evidence —
          // flipping overallStatus to degraded for every consumer on every
          // rebuild hiccup was the false-alarm culture this order removes.
          const serviceState = String(
            data?.service?.suspendedIndicator ?? data?.service?.status ?? data?.status ?? "",
          ).toLowerCase();
          const serviceLive = !["suspended", "deactivated", "crashed", "deploy_failed"].includes(serviceState);
          if (serviceLive && deployDerived === "degraded") {
            return {
              ...data,
              status: "healthy",
              error: `last deploy ${deployStatus} — service still serving on the previous release (pipeline attention needed)`,
            };
          }
          return {
            ...data,
            status: deployDerived,
            error: `last deploy ${deployStatus}${serviceLive ? " — service serving on the previous release" : " and service not live"}`,
          };
        }
        return data;
      },
      "github": async () => {
        const { getAccountConfig, githubHeaders } = await import("../adapters/github/index.js");
        const { httpRequest } = await import("../lib/http.js");
        const { apiKey: token, baseUrl } = getAccountConfig("github-primary");
        const res = await httpRequest(baseUrl, {
          headers: githubHeaders(token),
          timeoutMs: 6000,
          retries: 0,
        });
        if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
        return res.data;
      },
      "supabase": () => getSupabaseHealth("supabase-primary"),
      "redis": () => pingRedis(),
      "cloudflare": () => getWorkerStatus(),
      "infisical": () => auditSecrets(),
      "stripe": () => checkStripe(),
      "vercel": () => checkVercel(),
      "firecrawl": () => checkFirecrawl(),
      "kaggle": () => checkKaggle(),
      "qdrant": () => checkQdrant(),
      "telegram": () => checkTelegram(),
    };

    // Dynamically add AI providers
    try {
      const aiProviders = listProviders() as any[];
      for (const p of aiProviders) {
        checks[`ai-${p.provider}`] = () => testProvider(p.provider);
      }
    } catch(e) {
      // Ignore if AI providers fail to list
    }

    // Execute all checks in parallel
    const promises = Object.entries(checks).map(async ([provider, fn]) => {
      const oldSnap = globalHealthCache.getSnapshot(provider);
      const newSnap = await this.executeCheck(provider, fn);
      
      // Update Cache
      globalHealthCache.setSnapshot(newSnap);
      
      // Evaluate Incidents
      const incident = globalIncidentEngine.evaluateTransition(
        provider,
        oldSnap,
        newSnap.status,
        newSnap.error
      );
      
      if (incident) {
        incidents.push(incident);
        console.warn(`[HealthEngine] Incident Detected: [${incident.type}] ${incident.message}`);
        // Persistent incident history (gap closure: health history was process-local).
        await globalHealthHistoryStore.append({
          provider,
          status: newSnap.status,
          incident,
          snapshot: newSnap,
        });
      }
    });

    await Promise.allSettled(promises);

    const snapshots = globalHealthCache.getAllSnapshots();
    const dependencyImpact = Object.fromEntries(
      Object.entries(snapshots).map(([provider, snapshot]) => [provider, snapshot.impactedServices])
    );
    const statuses = Object.values(snapshots).map((snapshot) => snapshot.status);
    const overallStatus = statuses.includes("down") || statuses.includes("circuit_open")
      ? "down" : statuses.includes("degraded") ? "degraded" : statuses.includes("unknown") ? "unknown" : "healthy";
    // Persist a sweep summary so full-sweep history is durable, not just incidents.
    await globalHealthHistoryStore.append({
      provider: "__sweep__",
      status: overallStatus,
      overallStatus,
      snapshot: undefined,
    });
    return {
      timestamp: new Date().toISOString(), durationMs: Date.now() - start, incidents, snapshots,
      dependencyImpact, overallStatus,
    };
  }
}

export const globalHealthEngine = new HealthEngine();
