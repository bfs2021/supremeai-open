import { HealthSnapshot } from "./snapshot.js";
import { globalDependencyGraph } from "./dependency.js";
import { globalHealthHistoryStore } from "./history.js";

export interface IncidentAlert {
  id: string;
  provider: string;
  timestamp: string;
  type: "DEGRADED" | "OUTAGE" | "RECOVERY";
  message: string;
  impactedServices: string[];
}

export class IncidentEngine {
  /**
   * Evaluates the new snapshot against the old one to detect state transitions.
   * Emits an incident alert if a transition crosses a severity threshold.
   */
  public evaluateTransition(
    provider: string,
    oldSnap: HealthSnapshot | undefined,
    newStatus: HealthSnapshot["status"],
    errorDetails?: string
  ): IncidentAlert | null {
    const oldStatus = oldSnap?.status || "healthy";
    
    // No state change
    if (oldStatus === newStatus) {
      return null;
    }

    const impacted = globalDependencyGraph.getImpactedServices(provider);
    const timestamp = new Date().toISOString();
    const id = `INC-${Date.now().toString(36)}`;

    // Transition: Healthy -> Degraded/Down/Circuit Open
    if (oldStatus === "healthy" && newStatus !== "healthy") {
      const type = newStatus === "down" || newStatus === "circuit_open" ? "OUTAGE" : "DEGRADED";
      return {
        id,
        provider,
        timestamp,
        type,
        message: errorDetails
          ? `Provider ${provider} transitioned to ${newStatus}. Error: ${errorDetails}`
          : `Provider ${provider} transitioned to ${newStatus}. No error captured — inspect snapshot evidence for the transition reason.`,
        impactedServices: impacted
      };
    }

    // Transition: Down/Degraded -> Healthy
    if (oldStatus !== "healthy" && newStatus === "healthy") {
      return {
        id,
        provider,
        timestamp,
        type: "RECOVERY",
        message: `Provider ${provider} has recovered and is now healthy.`,
        impactedServices: impacted
      };
    }

    // Degraded -> Down (Escalation)
    if (oldStatus === "degraded" && (newStatus === "down" || newStatus === "circuit_open")) {
       return {
        id,
        provider,
        timestamp,
        type: "OUTAGE",
        message: errorDetails
          ? `Provider ${provider} escalated from degraded to ${newStatus}. Error: ${errorDetails}`
          : `Provider ${provider} escalated from degraded to ${newStatus}. No error captured — inspect snapshot evidence.`,
        impactedServices: impacted
      };
    }

    return null;
  }

  /**
   * Reports an external incident (from Webhook/Gateway).
   * The incident is persisted to durable history so it survives restarts.
   */
  public async reportExternalIncident(provider: string, message: string): Promise<void> {
    const impacted = globalDependencyGraph.getImpactedServices(provider);
    const alert: IncidentAlert = {
      id: `INC-${Date.now().toString(36)}`,
      provider,
      timestamp: new Date().toISOString(),
      type: "OUTAGE",
      message,
      impactedServices: impacted
    };
    
    console.error(`[INCIDENT] External incident reported for ${provider}: ${message}`);
    await globalHealthHistoryStore.append({ provider, status: "down", incident: alert });
    await this.sendTelegramAlert(alert);
  }

  /**
   * Sends a Telegram alert.
   */
  public async sendTelegramAlert(alert: IncidentAlert): Promise<void> {
    const { env } = await import("../lib/env.js");
    const { httpRequest } = await import("../lib/http.js");

    const { telegramBotToken, telegramChatId } = env.notify;
    if (!telegramBotToken || !telegramChatId) return;

    const icon = alert.type === "RECOVERY" ? "✅" : alert.type === "OUTAGE" ? "🚨" : "⚠️";
    const text = `${icon} **[${alert.type}] ${alert.provider}**\n\n${alert.message}\n\nImpacted: ${alert.impactedServices.join(", ")}`;

    try {
      await httpRequest(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { chat_id: telegramChatId, text, parse_mode: "Markdown" },
        timeoutMs: 5000
      });
    } catch (err: any) {
      console.error(`[INCIDENT] Failed to send Telegram alert: ${err.message}`);
    }

    // Phase 8: Trigger Autonomous Remediation
    if (alert.type === "OUTAGE") {
      import("../remediation/engine.js").then(({ globalRemediationEngine }) => {
         globalRemediationEngine.evaluateAndFix(alert).catch(err => {
           console.error(`[REMEDIATION] Error during auto-fix: ${err.message}`);
         });
      }).catch(console.error);
    }
  }
}

export const globalIncidentEngine = new IncidentEngine();

// Hook up Event Gateway
import("../events/gateway.js").then(({ globalEventGateway }) => {
  globalEventGateway.subscribe(async (event) => {
    if (event.severity === "CRITICAL") {
      await globalIncidentEngine.reportExternalIncident(event.source, event.message);
    }
  });
}).catch(console.error);
