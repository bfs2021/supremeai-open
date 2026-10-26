/**
 * SupremeAI Service — Platform-Agnostic Backend Communication Core
 *
 * VS Code extension ও Electron desktop app দুটোই একই সার্ভিস ব্যবহার করে
 * SupremeAI backend-এর সাথে কথা বলে।
 *
 * bridge-20261027-client-streaming-retry (#1333) — reliability rework:
 * 1. streamChatMessage(): native fetch + ReadableStream SSE (POST /api/v1/stream/chat),
 *    mirroring studio's secureSse.ts patterns — zero new dependencies.
 * 2. Central requestWithRetry(): x2 exponential backoff + jitter on network/5xx/429,
 *    AbortController plumbed through, 120s overall budget (Render cold starts > 10s).
 * 3. Typed ApiError replaces silent catch-swallowing; error channel stays leveled
 *    (console.error only, console.log removed from hot interceptors).
 * 4. getInlineCompletions: prefix-hash cache + capped prefix payload (FIM endpoint
 *    remains a follow-up — see work order).
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type {
  SupremeAIConfig,
  LearningUpload,
  LearningResponse,
  CodeEdit,
  ErrorReport,
  SuggestionFeedback,
  ChatRequest,
  ChatResponse,
  CodeFlowAnalysis,
  CodeFlowAnalysisRequest,
  CodeFlowAnalysisResponse,
  ErrorResolutionRequest,
  ErrorResolutionResponse,
  SecurityIssue,
  HealthScore,
  DependencyGraph,
  CodeAnalysis,
} from '../types';

/** Token provider — প্ল্যাটফর্ম থেকে টোকেন নেওয়ার abstraction। */
export interface TokenProvider {
  getToken(): string | null;
}

/** Typed API error (#1333) — no more silent swallowing. */
export class ApiError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly requestId?: string;
  readonly status?: number;

  constructor(code: string, userMessage: string, opts: { status?: number; requestId?: string; cause?: unknown } = {}) {
    super(userMessage);
    this.name = 'ApiError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = opts.status;
    this.requestId = opts.requestId;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** Normalize any thrown value into a typed ApiError. */
export function normalizeApiError(err: unknown, fallbackMessage = 'Request failed'): ApiError {
  if (err instanceof ApiError) return err;
  const anyErr = err as { response?: { status?: number; headers?: Record<string, unknown> }; message?: string; code?: string };
  const status = anyErr?.response?.status;
  const requestId =
    (anyErr?.response?.headers?.['x-request-id'] as string | undefined) ??
    (anyErr?.response?.headers?.['request-id'] as string | undefined);
  const code = anyErr?.code ?? (status ? `HTTP_${status}` : 'NETWORK_ERROR');
  const userMessage =
    status === 0 || (!status && !anyErr?.response)
      ? 'Backend unreachable — it may be waking up (free-tier cold start). Retrying is safe.'
      : anyErr?.message || fallbackMessage;
  return new ApiError(code, userMessage, { status, requestId, cause: err });
}

/** Default overall budget: Render free-tier cold starts routinely exceed 10s (#1333). */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Retry policy: 2 retries (3 attempts total), exponential with jitter. */
const MAX_RETRIES = 2;

export class SupremeAIService {
  private client: AxiosInstance;
  private config: SupremeAIConfig;
  private sessionId: string;
  private tokenProvider?: TokenProvider;
  /** Prefix-hash cache for inline completions (#1333). */
  private completionCache = new Map<string, string[]>();

  constructor(config: SupremeAIConfig, tokenProvider?: TokenProvider) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.sessionId = this.generateSessionId();

    const timeoutMs = this.resolveTimeoutMs();
    this.client = axios.create({
      baseURL: config.backendUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor — auth only. Hot-path logging is debug-gated (#1333:
    // bare console.log with eslint-disable leaked every request in production).
    this.client.interceptors.request.use((request) => {
      const token = this.resolveToken();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (this.isDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.debug(`[SupremeAI] ${request.method?.toUpperCase()} ${request.url}`);
      }
      return request;
    });

    // Response interceptor — structured, typed error channel
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const apiError = normalizeApiError(error, 'API request failed');
        // eslint-disable-next-line no-console
        console.error(`[SupremeAI] API Error ${apiError.code}: ${apiError.userMessage}`);
        return Promise.reject(apiError);
      }
    );
  }

  private resolveTimeoutMs(): number {
    const configured = (this.config as SupremeAIConfig & { requestTimeoutMs?: number }).requestTimeoutMs;
    return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  }

  private isDebugEnabled(): boolean {
    // Node (VS Code/Electron main) and browser both honor this flag name.
    const flag =
      typeof process !== 'undefined' && typeof process.env !== 'undefined'
        ? process.env.SUPREMEAI_DEBUG
        : (globalThis as { SUPREMEAI_DEBUG?: string }).SUPREMEAI_DEBUG;
    return flag === '1' || flag === 'true';
  }

  private resolveToken(): string | null {
    return this.tokenProvider?.getToken() ?? null;
  }

  private authHeaders(): Record<string, string> {
    const token = this.resolveToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private generateSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `session-${crypto.randomUUID()}`;
    }
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Central retry helper (#1333): network errors, 5xx and 429 are retried
   * MAX_RETRIES times with exponential backoff + jitter; other 4xx fail fast.
   */
  private async requestWithRetry<T>(op: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new ApiError('ABORTED', 'Request cancelled by caller');
      }
      try {
        return await op();
      } catch (err) {
        lastError = err;
        const apiError = normalizeApiError(err);
        const retryable =
          apiError.code === 'NETWORK_ERROR' ||
          apiError.code === 'ECONNABORTED' ||
          (typeof apiError.status === 'number' && (apiError.status >= 500 || apiError.status === 429));
        if (!retryable || attempt === MAX_RETRIES) {
          throw apiError;
        }
        const base = 400 * Math.pow(2, attempt); // 400ms, 800ms
        const jitter = Math.floor(Math.random() * 250);
        await new Promise<void>((resolve) => setTimeout(resolve, base + jitter));
      }
    }
    throw normalizeApiError(lastError);
  }

  // ========== Knowledge / Learning API ==========

  async sendCodeEdit(edit: CodeEdit): Promise<LearningResponse> {
    if (!this.config.enableRealTimeLearning) {
      return { success: false, message: 'Real-time learning disabled' };
    }
    try {
      const payload: LearningUpload = { type: 'CODE_EDIT', data: edit, sessionId: this.sessionId };
      const res = await this.requestWithRetry(() => this.client.post<LearningResponse>('/api/knowledge/learn', payload));
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to send code edit');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] sendCodeEdit failed (${apiError.code}): ${apiError.userMessage}`);
      return { success: false, message: apiError.userMessage };
    }
  }

  async reportError(error: ErrorReport): Promise<LearningResponse> {
    if (!this.config.autoReportErrors) {
      return { success: false, message: 'Auto-error reporting disabled' };
    }
    try {
      const payload: LearningUpload = { type: 'ERROR_REPORT', data: error, sessionId: this.sessionId };
      const res = await this.requestWithRetry(() => this.client.post<LearningResponse>('/api/knowledge/failure', payload));
      return res.data;
    } catch (err: unknown) {
      const apiError = normalizeApiError(err, 'Failed to report error');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] reportError failed (${apiError.code}): ${apiError.userMessage}`);
      return { success: false, message: apiError.userMessage };
    }
  }

  async sendFeedback(feedback: SuggestionFeedback): Promise<LearningResponse> {
    return this.sendSuggestionFeedback(feedback);
  }

  async sendSuggestionFeedback(feedback: SuggestionFeedback): Promise<LearningResponse> {
    try {
      const payload: LearningUpload = { type: 'SUGGESTION_FEEDBACK', data: feedback, sessionId: this.sessionId };
      const res = await this.requestWithRetry(() => this.client.post<LearningResponse>('/api/knowledge/feedback', payload));
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to send feedback');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] sendSuggestionFeedback failed (${apiError.code}): ${apiError.userMessage}`);
      return { success: false, message: apiError.userMessage };
    }
  }

  async getLearningStats(): Promise<{ recentActivity: Array<{ type: string, message: string, timestamp: string }> }> {
    try {
      const res = await this.requestWithRetry(() => this.client.get('/api/knowledge/stats'));
      return res.data;
    } catch (error: unknown) {
      // Typed failure surfaced on the error channel instead of a silent empty
      // fallback (#1333). Shape stays backward-compatible for existing callers.
      const apiError = normalizeApiError(error, 'Failed to load learning stats');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getLearningStats failed (${apiError.code}): ${apiError.userMessage}`);
      return { recentActivity: [] };
    }
  }

  async sendCodeAnalysis(filePath: string, code: string, language: string): Promise<LearningResponse> {
    try {
      const analysis: CodeAnalysis = {
        filePath,
        code,
        language,
        timestamp: new Date().toISOString(),
        metrics: this.analyzeCodeMetrics(code, language),
      };
      const payload: LearningUpload = { type: 'CODE_ANALYSIS', data: analysis, sessionId: this.sessionId };
      const res = await this.requestWithRetry(() => this.client.post<LearningResponse>('/api/knowledge/learn', payload));
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to analyze code');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] sendCodeAnalysis failed (${apiError.code}): ${apiError.userMessage}`);
      return { success: false, message: apiError.userMessage };
    }
  }

  async getInlineCompletions(prefix: string, suffix: string, fileName: string, languageId: string): Promise<{ suggestions: string[] }> {
    // Cap the payload (#1333): full-file prefixes made completion calls slow and
    // expensive; FIM endpoint + stop sequences remain a backend follow-up.
    const MAX_PREFIX_CHARS = 4_000;
    const effectivePrefix = prefix.length > MAX_PREFIX_CHARS ? prefix.slice(-MAX_PREFIX_CHARS) : prefix;
    const cacheKey = `${languageId}:${fileName}:${hashString(effectivePrefix)}`;
    const cached = this.completionCache.get(cacheKey);
    if (cached) {
      return { suggestions: cached };
    }
    try {
      const request: ChatRequest = {
        message: `Complete this code:\n${effectivePrefix}`,
        sessionId: this.sessionId,
        context: { source: 'desktop', language: languageId, timestamp: new Date().toISOString() }
      };
      const res = await this.requestWithRetry(
        () => this.client.post<ChatResponse>('/api/completion', request),
      );
      const suggestions = [res.data.response];
      if (this.completionCache.size >= 50) {
        // LRU-ish eviction: drop the oldest inserted key.
        const oldest = this.completionCache.keys().next().value;
        if (oldest !== undefined) this.completionCache.delete(oldest);
      }
      this.completionCache.set(cacheKey, suggestions);
      return { suggestions };
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Inline completion failed');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getInlineCompletions failed (${apiError.code}): ${apiError.userMessage}`);
      return { suggestions: [] };
    }
  }

  // ========== Chat API ==========

  async sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
    try {
      const res = await this.requestWithRetry(() =>
        this.client.post<ChatResponse>('/api/chat', {
          ...request,
          context: {
            ...(request.context ?? {}),
            source: request.context?.source ?? 'desktop',
            timestamp: request.context?.timestamp || new Date().toISOString(),
          },
        }),
      );
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Chat request failed');
      return {
        success: false,
        message: `Chat request failed (${apiError.code})`,
        response: `⚠️ চ্যাট ব্যাকএন্ড এখনে পৌঁছাতে পারেনি: ${apiError.userMessage}`,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Streaming chat (#1333) — token-by-token via SSE.
   *
   * Talks to the same endpoint the web studio uses (`POST /api/v1/stream/chat`,
   * core/api/routes/stream_chat_sse.py). Uses native fetch + ReadableStream so
   * the shared package needs no new dependency; mirrors secureSse.ts semantics:
   * `data:` frames, `[DONE]` sentinel, heartbeat frames ignored, abort plumbed.
   *
   * @param opts.onToken  called per incremental text chunk
   * @param opts.signal   abort signal — cancels BOTH sides
   * @returns the assembled full response (also delivered chunk-by-chunk)
   */
  async streamChatMessage(
    request: ChatRequest,
    opts: { onToken?: (token: string) => void; signal?: AbortSignal } = {},
  ): Promise<ChatResponse> {
    const url = `${this.config.backendUrl.replace(/\/$/, '')}/api/v1/stream/chat`;
    const started = Date.now();
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          ...request,
          context: {
            ...(request.context ?? {}),
            source: request.context?.source ?? 'desktop',
            timestamp: request.context?.timestamp || new Date().toISOString(),
          },
        }),
        signal: opts.signal,
      });
      if (!resp.ok || !resp.body) {
        // Non-streaming failure — fall back to the retrying non-stream path so
        // callers always get a usable answer (e.g. proxy stripped SSE).
        // eslint-disable-next-line no-console
        console.error(`[SupremeAI] stream unavailable (HTTP ${resp.status}); falling back to buffered chat`);
        return this.sendChatMessage(request);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      let sessionId = request.sessionId ?? this.sessionId;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; be tolerant of \r\n.
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue; // ignore event:/comment/heartbeat lines
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data) as Record<string, unknown>;
            } catch {
              // Some gateways send raw text chunks — treat them as tokens.
              full += data;
              opts.onToken?.(data);
              continue;
            }
            const sid = parsed.sessionId ?? parsed.session_id;
            if (typeof sid === 'string') sessionId = sid;
            const token =
              (parsed.token as string | undefined) ??
              (parsed.delta as string | undefined) ??
              (parsed.content as string | undefined) ??
              (typeof parsed.response === 'string' ? parsed.response : undefined);
            if (typeof token === 'string' && token.length > 0) {
              full += token;
              opts.onToken?.(token);
            }
          }
        }
      }
      return {
        success: true,
        response: full,
        sessionId,
        timestamp: new Date().toISOString(),
      } as ChatResponse;
    } catch (error: unknown) {
      if (opts.signal?.aborted || (error as { name?: string })?.name === 'AbortError') {
        throw new ApiError('ABORTED', 'Stream cancelled by caller');
      }
      const apiError = normalizeApiError(error, 'Streaming chat failed');
      // eslint-disable-next-line no-console
      console.error(
        `[SupremeAI] streamChatMessage failed after ${Date.now() - started}ms (${apiError.code}); falling back to buffered chat`
      );
      return this.sendChatMessage(request);
    }
  }

  // ========== CodeFlow API ==========

  async analyzeRepository(request: CodeFlowAnalysisRequest): Promise<CodeFlowAnalysisResponse> {
    const response = await this.startCodeFlowAnalysis(request);
    return response ?? {
      success: false,
      analysisId: '',
      data: {
        repositoryId: '',
        files: [],
        dependencies: { nodes: [], edges: [] },
        patterns: [],
        securityIssues: [],
        healthScore: {
          score: 0,
          grade: 'F',
          breakdown: { security: 0, maintainability: 0, complexity: 0, documentation: 0, testing: 0 },
          details: [],
        },
        analysisTimestamp: new Date().toISOString(),
        status: 'failed',
      },
      message: 'Repository analysis failed',
    };
  }

  async startCodeFlowAnalysis(request: CodeFlowAnalysisRequest): Promise<CodeFlowAnalysisResponse | null> {
    try {
      const res = await this.requestWithRetry(() => this.client.post<CodeFlowAnalysisResponse>('/api/codeflow/analyze', request));
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'CodeFlow analysis failed');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] CodeFlow analysis failed (${apiError.code}): ${apiError.userMessage}`);
      return null;
    }
  }

  async getCodeFlowAnalysis(analysisId: string): Promise<CodeFlowAnalysis | null> {
    try {
      const res = await this.requestWithRetry(() =>
        this.client.get<CodeFlowAnalysisResponse>(`/api/codeflow/analysis/${analysisId}`),
      );
      return res.data.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to get codeflow analysis');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getCodeFlowAnalysis failed (${apiError.code}): ${apiError.userMessage}`);
      return null;
    }
  }

  async resolveError(request: ErrorResolutionRequest): Promise<ErrorResolutionResponse | null> {
    try {
      const res = await this.requestWithRetry(() => this.client.post<ErrorResolutionResponse>('/api/codeflow/resolve', request));
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Error resolution failed');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] resolveError failed (${apiError.code}): ${apiError.userMessage}`);
      return null;
    }
  }

  async getRepositorySecurityIssues(repositoryId: string, severity?: string): Promise<SecurityIssue[]> {
    try {
      const res = await this.requestWithRetry(() =>
        this.client.get<SecurityIssue[]>(`/api/codeflow/repository/${repositoryId}/security`, {
          params: { severity },
        }),
      );
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to get security issues');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getRepositorySecurityIssues failed (${apiError.code}): ${apiError.userMessage}`);
      return [];
    }
  }

  async getDependencyGraph(repositoryId: string): Promise<DependencyGraph | null> {
    try {
      const res = await this.requestWithRetry(() =>
        this.client.get<DependencyGraph>(`/api/codeflow/repository/${repositoryId}/dependencies`),
      );
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to get dependency graph');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getDependencyGraph failed (${apiError.code}): ${apiError.userMessage}`);
      return null;
    }
  }

  async getHealthScore(repositoryId: string): Promise<HealthScore | null> {
    try {
      const res = await this.requestWithRetry(() =>
        this.client.get<HealthScore>(`/api/codeflow/repository/${repositoryId}/health`),
      );
      return res.data;
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'Failed to get health score');
      // eslint-disable-next-line no-console
      console.error(`[SupremeAI] getHealthScore failed (${apiError.code}): ${apiError.userMessage}`);
      return null;
    }
  }

  // ========== Helpers ==========

  private analyzeCodeMetrics(code: string, language: string): CodeAnalysis['metrics'] {
    const lines = code.split('\n');
    return {
      linesOfCode: lines.length,
      nonEmptyLines: lines.filter((l) => l.trim().length > 0).length,
      commentLines:
        language === 'typescript' || language === 'javascript'
          ? lines.filter((l) => l.trim().startsWith('//') || l.trim().startsWith('/*')).length
          : 0,
      complexityEstimate: this.estimateComplexity(code),
    };
  }

  private estimateComplexity(code: string): number {
    const decisionPoints = (code.match(/\b(if|else|for|while|switch|case|catch)\b/g) || []).length;
    return decisionPoints + 1;
  }

  updateConfig(newConfig: Partial<SupremeAIConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

function hashString(input: string): string {
  // FNV-1a 32-bit — cheap, stable, dependency-free prefix hashing.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Singleton helper */
let supremeAIService: SupremeAIService | null = null;

export function getSupremeAIService(config?: SupremeAIConfig, tokenProvider?: TokenProvider): SupremeAIService {
  if (!supremeAIService && config) {
    supremeAIService = new SupremeAIService(config, tokenProvider);
  }
  if (!supremeAIService) {
    throw new Error('SupremeAIService not initialized. Call getSupremeAIService(config) first.');
  }
  return supremeAIService;
}

export function setSupremeAIService(service: SupremeAIService): void {
  supremeAIService = service;
}
