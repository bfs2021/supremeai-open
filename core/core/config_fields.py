"""Pydantic field declarations for SupremeAI settings."""

from typing import Annotated, Any, ClassVar

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import NoDecode

# Roadmap 1.4 (issue #1173): the single origin/list parser now lives in the
# dependency-free leaf module `core.config_parsers`; re-exported here so the
# historical `from core.config_fields import parse_origin_list` path keeps
# working. Middleware (cors_policy) imports the leaf directly — it must stay
# pydantic-free, and this module deliberately pulls in pydantic.
from core.config_parsers import parse_origin_list  # re-export (do not remove)

__all__ = ["SettingsFieldsMixin", "parse_origin_list"]


class SettingsFieldsMixin:
    PROJECT_NAME: str = "SupremeAI 2.0"
    API_V1_STR: str = "/api/v1"
    app_name: str = "SupremeAI 2.0"

    # ── LLM Gateway & Streaming Configuration ────────────────────────────────
    LLM_CONNECT_TIMEOUT: float = Field(default=5.0, validation_alias="LLM_CONNECT_TIMEOUT")
    LLM_READ_TIMEOUT: float = Field(default=30.0, validation_alias="LLM_READ_TIMEOUT")
    LLM_WRITE_TIMEOUT: float = Field(default=5.0, validation_alias="LLM_WRITE_TIMEOUT")
    LLM_POOL_TIMEOUT: float = Field(default=5.0, validation_alias="LLM_POOL_TIMEOUT")
    LLM_MAX_CONNECTIONS: int = Field(default=100, validation_alias="LLM_MAX_CONNECTIONS")
    LLM_MAX_KEEPALIVE: int = Field(default=20, validation_alias="LLM_MAX_KEEPALIVE")

    LATENCY_WINDOW_SIZE: int = Field(default=20, validation_alias="LATENCY_WINDOW_SIZE")
    LATENCY_NORMALIZATION_MS: float = Field(
        default=1000.0, validation_alias="LATENCY_NORMALIZATION_MS"
    )
    MIN_PROVIDER_WEIGHT: float = Field(default=0.01, validation_alias="MIN_PROVIDER_WEIGHT")
    CIRCUIT_FAILURE_THRESHOLD: int = Field(default=5, validation_alias="CIRCUIT_FAILURE_THRESHOLD")
    CIRCUIT_SUCCESS_RATE_FLOOR: float = Field(
        default=0.5, validation_alias="CIRCUIT_SUCCESS_RATE_FLOOR"
    )
    CIRCUIT_COOLDOWN_SECONDS: float = Field(
        default=30.0, validation_alias="CIRCUIT_COOLDOWN_SECONDS"
    )
    MAX_ROUTING_ATTEMPTS: int = Field(default=3, validation_alias="MAX_ROUTING_ATTEMPTS")

    # ── Docs / OpenAPI exposure policy (P0 — production sign-off) ──────────
    # বাংলা: প্রোডাকশনে /docs, /redoc, openapi.json ডিফল্টভাবে বন্ধ থাকবে।
    # docs_enabled হলো tri-state: None (unset) → local-এ চালু, production/
    # staging-এ বন্ধ। SUPREMEAI_DOCS_ENABLED=true দিয়ে প্রোডাকশনে স্পষ্ট
    # অপট-ইন করা যায়, তখন শক্তিশালী SUPREMEAI_DOCS_PASSWORD বাধ্যতামূলক
    # (validate_all ফেইল-ফাস্ট করে) — "dev_password_only" কখনো প্রোডাকশন
    # ফলব্যাক হতে পারবে না।
    docs_enabled: bool | None = Field(default=None, validation_alias="SUPREMEAI_DOCS_ENABLED")
    docs_auth_enabled: bool = True
    docs_username: str = Field(default="admin", validation_alias="SUPREMEAI_DOCS_USERNAME")
    docs_password: SecretStr = Field(
        default=SecretStr("dev_password_only"),
        validation_alias="SUPREMEAI_DOCS_PASSWORD",
    )

    # এই ডিফল্ট পাসওয়ার্ডটি শুধু local ডেভেলপমেন্টের জন্য; প্রোডাকশনে
    # এটি কখনোই বৈধ গেট হিসেবে গণ্য হবে না।
    DOCS_DEV_FALLBACK_PASSWORDS: ClassVar[frozenset[str]] = frozenset({"", "dev_password_only"})

    @property
    def docs_password_ok(self) -> bool:
        """Return True when the docs password is strong enough for a gated deployment.

        বাংলা: ডকুমেন্টেশন গেটের জন্য পাসওয়ার্ড যথেষ্ট শক্তিশালী কিনা।
        ডিফল্ট ডেভ ফলব্যাক বা খুব ছোট পাসওয়ার্ড প্রোডাকশনে গ্রহণযোগ্য নয়।
        """
        pwd = self.docs_password.get_secret_value() if self.docs_password else ""
        if pwd.lower() in self.DOCS_DEV_FALLBACK_PASSWORDS:
            return False
        return len(pwd) >= 12

    @property
    def effective_docs_enabled(self) -> bool:
        """Resolve the runtime docs/OpenAPI exposure policy.

        বাংলা: local/dev-এ ডিফল্ট চালু; production/staging-এ ডিফল্ট বন্ধ,
        শুধুমাত্র স্পষ্ট SUPREMEAI_DOCS_ENABLED=true এবং শক্তিশালী
        পাসওয়ার্ড থাকলে চালু হয়।
        """
        if (self.env or "").lower() in ("production", "staging"):
            return bool(self.docs_enabled) and self.docs_password_ok
        if self.docs_enabled is None:
            return True
        return bool(self.docs_enabled)

    # ── Internal admin secret (P0 — fail-closed, no docs_password fallback) ─
    # বাংলা: internal admin রুটের X-Admin-Secret গেট আগে docs_password-এ
    # ফলব্যাক করত — ফলে পাবলিক রিপোর জানা "dev_password_only" মানটিই
    # প্রোডাকশনে বৈধ অ্যাডমিন সিক্রেট হয়ে যেত। এখন আলাদা, শক্তিশালী
    # SUPREMEAI_ADMIN_SECRET বাধ্যতামূলক (production/staging-এ validate_all
    # ফেইল-ফাস্ট) এবং runtime গেটে কোনো ফলব্যাক নেই।
    supremeai_admin_secret: SecretStr = Field(
        default=SecretStr(""),
        validation_alias="SUPREMEAI_ADMIN_SECRET",
    )

    ADMIN_SECRET_DEV_FALLBACKS: ClassVar[frozenset[str]] = frozenset({"", "dev_password_only"})

    @property
    def admin_secret_ok(self) -> bool:
        """Return True when the internal admin secret is production-safe.

        বাংলা: খালি মান, পাবলিক ডেভ ফলব্যাক, বা ১২ অক্ষরের কম সিক্রেট
        প্রোডাকশন-গ্রেড নয়। docs_password-এর সমান হলেও নয় (reuse নিষেধ)।
        """
        pwd = self.supremeai_admin_secret.get_secret_value() if self.supremeai_admin_secret else ""
        if pwd.lower() in self.ADMIN_SECRET_DEV_FALLBACKS:
            return False
        if pwd == self.docs_password.get_secret_value():
            return False
        return len(pwd) >= 12

    # ── নেটওয়ার্ক কনফিগ — সব env-driven, কোনো hardcode নেই ────────────────
    port: int = Field(
        default=8080, validation_alias="PORT"
    )  # বাংলা: Dockerfile CMD-এর ${PORT:-8080} default-এর সাথে consistent
    # bind-all listen default; HOST env overrides it (dev/local semantics)
    host: str = Field(default="0.0.0.0", validation_alias="HOST")  # is_local()

    # ── Canonical Portal Endpoints ──────────────────────────────────────────
    frontend_url: str = Field(default="", validation_alias="FRONTEND_URL")
    admin_url: str = Field(default="", validation_alias="ADMIN_URL")
    backend_url: str = Field(default="", validation_alias="BACKEND_URL")
    app_base_url: str = Field(default="", validation_alias="APP_BASE_URL")

    # ── Personal MCP Gateway Hub (Task 7-d, plan Phase C) ────────────────────
    # বাংলা: vanity subdomain-এর base domain — gateway URL হয়
    # https://<slug>.<MCP_GATEWAY_DOMAIN>। এটি routing base মাত্র; কোনো
    # hardcoded credential নয়। Control-plane (Node) data-path Phase B-এ।
    mcp_gateway_domain: str = Field(
        default="mcp.supremeai.ai", validation_alias="MCP_GATEWAY_DOMAIN"
    )

    @property
    def frontend_base_url(self) -> str:
        """Compatibility property for routes using frontend_base_url."""
        if self.frontend_url:
            return self.frontend_url
        if self.is_local():
            return "http://localhost:3000"  # is_local() guarded dev portal URL
        return ""

    # CORS origins is implemented as a dynamic @property on SettingsSecretsMixin
    # (see config_secrets.py). It must NOT be redeclared as a static Field here —
    # a static Field on this mixin would shadow the property in the MRO and
    # silently disable env-driven CORS validation (incl. STRICT_CORS_TEST bypass).

    # Kept in sync with middleware/cors_policy.py defaults. Issue #1491:
    # https://supremeai-lac.vercel.app is dead in production (HTTP 404) and was
    # removed from the code-level defaults.
    user_cors_origins: str | list[str] = Field(
        default=[
            "https://supremeai-a.web.app",  # Firebase Hosting user portal
            "https://supremeai-studio.vercel.app",  # Vercel studio
        ],
        validation_alias="USER_CORS_ORIGINS",
    )
    admin_cors_origins: str | list[str] = Field(
        default=[
            # Admin-host retirement (2026-10-25, follows PR #1247): the legacy
            # Firebase Hosting admin console is fully removed from the defaults —
            # the admin console now lives in the Studio SPA at
            # https://supremeai-studio.pages.dev (route /admin).
            "https://supremeai-studio.pages.dev",
        ],
        validation_alias="ADMIN_CORS_ORIGINS",
    )
    enforce_anti_hacking: bool = Field(
        default=False,
        validation_alias="ENFORCE_ANTI_HACKING",
    )

    # বাংলা মন্তব্য: main.py-এর app_user/app_admin bootstrap-এর সাথে সামঞ্জস্যপূর্ণ একই SERVICE_ROLE flag।
    # DB pool sizing (database/session.py) এই মানের উপর ভিত্তি করে User vs Admin instance-এ আলাদা limit প্রয়োগ করে।
    service_role: str = Field(default="user", validation_alias="SERVICE_ROLE")

    # ── Open-Source Integrations Flags (backend/integrations/) ─────────────────
    # প্রতিটি upstream (mem0, Graphiti, browser-use, E2B) optional dependency;
    # flag false বা dependency absent থাকলে সিস্টেম zero-cost fallback দিয়ে চলে।
    mem0_enabled: bool = Field(default=False, validation_alias="SUPREMEAI_MEM0_ENABLED")
    graphiti_enabled: bool = Field(default=False, validation_alias="SUPREMEAI_GRAPHITI_ENABLED")
    browser_use_enabled: bool = Field(
        default=False, validation_alias="SUPREMEAI_BROWSER_USE_ENABLED"
    )
    e2b_enabled: bool = Field(default=False, validation_alias="SUPREMEAI_E2B_ENABLED")
    openhands_enabled: bool = Field(default=False, validation_alias="SUPREMEAI_OPENHANDS_ENABLED")
    openhands_server_url: str = Field(default="", validation_alias="OPENHANDS_SERVER_URL")

    # বাংলা মন্তব্য: JIT OTP over-saturation protection — প্রতি admin প্রতি এই সেকেন্ডে সর্বোচ্চ ১টি OTP।
    otp_cooldown_seconds: int = Field(default=60, validation_alias="OTP_COOLDOWN_SECONDS")

    # বাংলা মন্তব্য: Admin email list সম্পূর্ণ env-driven
    # (Moved to Security & Auth Config section to avoid duplication)

    # বাংলা মন্তব্য: Zero-Trust Host Validation — empty = crash
    # 🔧 DYNAMIC: Empty default — must be explicitly configured
    allowed_hosts: str | list[str] = Field(
        default=[],  # 🔧 CHANGED: No hardcoded hosts! Set ALLOWED_HOSTS in env.
        validation_alias="ALLOWED_HOSTS",
    )

    # ── Stripe, JWT & Encryption credentials — moved to Infisical-backed lazy properties ──

    # ── LLM rate limit thresholds — সব env-driven, hardcode নেই ─────────────
    # 🔧 NOTE: These defaults are provider-specific limits that may change.
    # Always check: https://ai.google.dev/gemini-api/docs/rate-limits
    # Override these via environment variables when providers update their limits.
    gemini_rpm_limit: int = Field(default=9, validation_alias="GEMINI_RPM_LIMIT")
    gemini_tpm_limit: int = Field(default=240_000, validation_alias="GEMINI_TPM_LIMIT")
    gemini_rpd_limit: int = Field(default=475, validation_alias="GEMINI_RPD_LIMIT")
    groq_rpm_limit: int = Field(default=28, validation_alias="GROQ_RPM_LIMIT")
    groq_tpm_limit: int = Field(default=28_500, validation_alias="GROQ_TPM_LIMIT")
    groq_rpd_limit: int = Field(default=13_680, validation_alias="GROQ_RPD_LIMIT")
    openrouter_rpm_limit: int = Field(default=19, validation_alias="OPENROUTER_RPM_LIMIT")
    openrouter_rpd_limit: int = Field(default=45, validation_alias="OPENROUTER_RPD_LIMIT")
    cloudflare_rpd_limit: int = Field(default=9_000, validation_alias="CLOUDFLARE_RPD_LIMIT")
    nvidia_rpm_limit: int = Field(default=38, validation_alias="NVIDIA_RPM_LIMIT")
    nvidia_tpm_limit: int = Field(default=38_000, validation_alias="NVIDIA_TPM_LIMIT")
    huggingface_rpm_limit: int = Field(default=18, validation_alias="HUGGINGFACE_RPM_LIMIT")
    huggingface_rpd_limit: int = Field(default=950, validation_alias="HUGGINGFACE_RPD_LIMIT")

    max_prompt_tokens: int = Field(default=4_000, validation_alias="MAX_PROMPT_TOKENS")
    max_response_tokens: int = Field(default=1_500, validation_alias="MAX_RESPONSE_TOKENS")
    max_cost_per_task: float = Field(default=0.01, validation_alias="MAX_COST_PER_TASK")
    enable_token_compression: bool = True

    # Central model registry: deployment operators can change routing without code edits.
    # FINAL-TEST FIX (2026-09-13): gemini-2.0-flash was retired by Google (404 on
    # every call) and groq/openrouter have no keys configured in this deployment,
    # so all defaults now point at the verified-working provider chain:
    # Gemini 2.5 Flash (key valid) -> BYNARA -> BAI (OpenAI-compatible routers).
    model_coding: str = Field(default="gemini/gemini-2.5-flash", validation_alias="MODEL_CODING")
    model_reasoning: str = Field(default="bynara/laguna-s-2.1", validation_alias="MODEL_REASONING")
    model_vision: str = Field(default="gemini/gemini-2.5-flash", validation_alias="MODEL_VISION")
    model_chat: str = Field(default="gemini/gemini-2.5-flash", validation_alias="MODEL_CHAT")
    model_general: str = Field(default="gemini/gemini-2.5-flash", validation_alias="MODEL_GENERAL")
    embedding_model: str = Field(
        default="text-embedding-3-small", validation_alias="EMBEDDING_MODEL"
    )
    model_multilingual: str = Field(
        default="gemini/gemini-2.5-flash",
        validation_alias="MODEL_MULTILINGUAL",
    )
    route_ladder_simple: str | list[str] = Field(
        default="gemini/gemini-2.5-flash,bynara/agnes-2.5-flash,bai/qwen3.8-flash",
        validation_alias="ROUTE_LADDER_SIMPLE",
    )
    route_ladder_medium: str | list[str] = Field(
        default="gemini/gemini-2.5-flash,bynara/laguna-s-2.1,bai/mimo-v2.5",
        validation_alias="ROUTE_LADDER_MEDIUM",
    )
    route_ladder_complex: str | list[str] = Field(
        default="gemini/gemini-2.5-pro,bynara/laguna-s-2.1,gemini/gemini-2.5-flash",
        validation_alias="ROUTE_LADDER_COMPLEX",
    )

    @property
    def task_models(self) -> dict[str, str]:
        return {
            "coding": self.model_coding,
            "reasoning": self.model_reasoning,
            "vision": self.model_vision,
            "chat": self.model_chat,
            "general": self.model_general,
        }

    @staticmethod
    def _csv(value: str | list[str]) -> list[str]:
        # Issue #684 (CORS DRY): delegates to the single shared origin/list
        # parser instead of keeping a second comma-split implementation.
        return parse_origin_list(value)

    @property
    def route_ladders(self) -> dict[str, list[str]]:
        return {
            "simple": self._csv(self.route_ladder_simple),
            "medium": self._csv(self.route_ladder_medium),
            "complex": self._csv(self.route_ladder_complex),
        }

    # ── Security & Auth Config ──────────────────────────────────────────────
    security_context_ttl: int = Field(default=86400, validation_alias="SECURITY_CONTEXT_TTL")
    security_caution_log_ttl: int = Field(
        default=86400, validation_alias="SECURITY_CAUTION_LOG_TTL"
    )
    # বাংলা মন্তব্য (M13 P-B zero-hardcode): OTP-pending এর Redis TTL — আগে
    # anti_hacking.py-তে ইন-কোড 300 স্থির ছিল (ডিফল্ট অপরিবর্তিত)।
    security_otp_pending_ttl: int = Field(default=300, validation_alias="SECURITY_OTP_PENDING_TTL")
    # বাংলা মন্তব্য (M13 P-B): tier-ভিত্তিক API রেট-সীমা — আগে rate_limiter.py-র
    # ইন-কোড _tier_limits dict-এ আটকে ছিল (tier-মূল্য বদলাতে কোড-ডিপ্লয় লাগত)।
    rate_limit_tier_free: int = Field(default=60, validation_alias="RATE_LIMIT_TIER_FREE")
    rate_limit_tier_pro: int = Field(default=600, validation_alias="RATE_LIMIT_TIER_PRO")
    rate_limit_tier_premium: int = Field(default=1200, validation_alias="RATE_LIMIT_TIER_PREMIUM")
    rate_limit_tier_enterprise: int = Field(
        default=6000, validation_alias="RATE_LIMIT_TIER_ENTERPRISE"
    )
    rate_limit_tier_window_seconds: int = Field(
        default=60, validation_alias="RATE_LIMIT_TIER_WINDOW_SECONDS"
    )
    # বাংলা মন্তব্য (M13 P-B): acquire() কলার limit/window না দিলে এই ডিফল্ট
    # (আগে ফাংশন-বডিতে স্থির 100/60)।
    rate_limit_default_limit: int = Field(default=100, validation_alias="RATE_LIMIT_DEFAULT_LIMIT")
    rate_limit_default_window: int = Field(default=60, validation_alias="RATE_LIMIT_DEFAULT_WINDOW")
    # বাংলা মন্তব্য (M13 P-B): near-limit warning ratio — আগে 0.8 স্থির।
    rate_limit_warn_ratio: float = Field(default=0.8, validation_alias="RATE_LIMIT_WARN_RATIO")
    # বাংলা মন্তব্য (M13 P-B): টেন্যান্ট রেট-সীমা — আগে tenant_rate_limiter.py-তে
    # স্থির 100 hits / 60s।
    tenant_rate_limit_max_hits: int = Field(
        default=100, validation_alias="TENANT_RATE_LIMIT_MAX_HITS"
    )
    tenant_rate_limit_window_seconds: int = Field(
        default=60, validation_alias="TENANT_RATE_LIMIT_WINDOW_SECONDS"
    )
    # বাংলা মন্তব্য (M13 P-C): Redis-বিভ্রাটে টেন্যান্ট-লিমিটারের fail-মোড —
    # V5.1 env-aware fail-policy ধারা। "open" (ডিফল্ট = আজকের আচরণ, নীরব
    # বাইপাস নয় — loud লগ বিদ্যমান) | "fallback" (বাউন্ডেড ইন-মেমরি sliding
    # window, per-instance) | "closed" (429 — কঠোর পরিবেশে)।
    tenant_rate_limit_fail_mode: str = Field(
        default="open", validation_alias="TENANT_RATE_LIMIT_FAIL_MODE"
    )
    admin_emails: str | list[str] = Field(default_factory=list, validation_alias="ADMIN_EMAILS")
    admin_enforce_totp: bool = Field(default=True, validation_alias="ADMIN_ENFORCE_TOTP")
    admin_authorized: bool = Field(default=False, validation_alias="ADMIN_AUTHORIZED")
    autofix_authorized: bool = Field(default=False, validation_alias="AUTOFIX_AUTHORIZED")

    supremeai_public_paths: str | list[str] = Field(
        default=[
            "/",
            "/health",
            "/health/live",
            "/health/ready",
            "/metrics",
            "/docs",
            "/redoc",
            # AUDIT FIX (final-test): the OpenAPI schema is mounted at
            # {API_V1_STR}/openapi.json (core/app_builder.py), NOT at
            # /openapi.json — the old entry pointed at a route that does not
            # exist, which made monitors report an empty/missing schema.
            "/api/v1/openapi.json",
            "/api/v1/auth/token",
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            # Audit fix (this session): /auth/refresh authenticates via the
            # refresh-token JWT carried in the JSON body (type=refresh enforced,
            # fail-closed inside the endpoint). It must NOT be gated by the
            # access-token middleware — otherwise token refresh is unreachable
            # (always 401) and clients can never renew sessions.
            "/api/v1/auth/refresh",
            # Issue #439: Kaggle kernels complete jobs by POSTing to this
            # callback; they cannot hold a JWT, so the path is auth-exempt but
            # guarded by the per-job callback token (kaggle.py enforces it
            # with secrets.compare_digest — forged completions are rejected).
            "/api/v1/kaggle/callback",
            "/actuator",
            "/api/admin/firebase-auth",
            "/api/admin/firebase-login",
            "/api/admin/firebase-totp-setup",
            "/api/admin/firebase-totp-verify",
            "/api/v1/health",
            "/api/v1/health/",
            # AUDIT FIX (final-test): the liveness/readiness probes are exposed
            # by core/health_routes.py as /live and /ready under BOTH the
            # /api/v1/health and /health prefixes. The previous entries
            # (/api/v1/live, /api/v1/ready) never existed, so k8s-style probes
            # against those paths fell through to the auth middleware (401).
            "/api/v1/health/live",
            "/api/v1/health/ready",
            "/api/voice/stream_audio",
            "/api/billing/webhook/stripe",
            "/api/billing/webhook/sslcommerz",
            # AUD-2.1: "/api/v1/markdown" removed from public paths — the markdown
            # export/search surface now requires authentication (router-level guard).
            "/api/config/public",
            # বাংলা মন্তব্য (ROOT-CAUSE FIX): "/api/task/stream" ও
            # "/api/preferences/default/stream" আগে এখানে (public paths) ছিল,
            # অথচ দুটো রুটই router/route-level dependencies=[Depends(get_current_user_token)]
            # দিয়ে auth বাধ্যতামূলক করে। AuthMiddleware public path হলে JWT decode করে
            # request.state.user সেট করে না — ফলে get_current_user_token সবসময় "Missing or
            # invalid authentication token" ধরে 401 দিত, ভ্যালিড Bearer token পাঠানো সত্ত���বেও।
            # এটাই ছিল TOTP verify সফল হওয়ার পরপরই dashboard-এ SSE স্ট্রিম ও থিম sync
            # 401 দিয়ে fail হওয়ার আসল কারণ। এখন middleware এই দুটো পাথেও টোকেন decode করে
            # request.state.user সেট করবে, তাই ডাউনস্ট্রিম dependency ঠিকভাবে token পাবে।
        ],
        validation_alias="SUPREMEAI_PUBLIC_PATHS",
    )

    prompt_blocked_patterns: str | list[str] = Field(
        default=["system prompt", "ignore all previous", "you are an administrative"],
        validation_alias="PROMPT_BLOCKED_PATTERNS",
    )
    rbac_role_definitions: Annotated[dict[str, list[str]], NoDecode] = Field(
        default_factory=lambda: {
            "admin": ["*"],
            "user": ["read", "write"],
            "guest": ["read"],
        },
        validation_alias="RBAC_ROLE_DEFINITIONS",
    )

    # ── Circuit Breaker Config ───────────────────────────────────────────────
    circuit_breaker_failure_threshold: int = Field(
        default=3, validation_alias="CIRCUIT_BREAKER_FAILURE_THRESHOLD"
    )
    circuit_breaker_cooldown_period: int = Field(
        default=60, validation_alias="CIRCUIT_BREAKER_COOLDOWN_PERIOD"
    )

    # ── Idempotency Config ───────────────────────────────────────────────
    # বাংলা মন্তব্য: idempotency_critical_paths সম্পূর্ণ env-driven।
    # IDEMPOTENCY_CRITICAL_PATHS="/api/orchestrate/generate,/api/billing/charge" (comma-separated)
    idempotency_critical_paths: str | list[str] = Field(
        default_factory=list,
        validation_alias="IDEMPOTENCY_CRITICAL_PATHS",
    )

    # ── Provider API Base URLs (Optional Proxies) ─────────────────────────
    openai_base_url: str = Field(default="", validation_alias="OPENAI_BASE_URL")
    deepseek_base_url: str = Field(default="", validation_alias="DEEPSEEK_BASE_URL")
    groq_base_url: str = Field(default="", validation_alias="GROQ_BASE_URL")
    anthropic_base_url: str = Field(default="", validation_alias="ANTHROPIC_BASE_URL")

    # ── Legacy / specific models ──────────────────────────────────────────────
    claude_openrouter_model: str = Field(
        default="anthropic/claude-3.5-haiku:free",
        validation_alias="CLAUDE_OPENROUTER_MODEL",
    )

    # বাংলা মন্তব্য: জেমিনি মডেল নাম সেন্ট্রালাইজড করা হলো যাতে কোনো ইউটিলিটি স্ক্রিপ্টে হার্ডকোড না থাকে।
    # FINAL-TEST FIX (2026-09-13): deployment env sends GEMINI_MODEL="gemini-2.5-flash"
    # but only GEMINI_MODEL_NAME was read, so the env override never applied and the
    # retired gemini-2.0-flash default was used everywhere. ValidationAlias accepts
    # both names now.
    gemini_model_name: str = Field(
        default="gemini/gemini-2.5-flash",
        validation_alias=AliasChoices("GEMINI_MODEL_NAME", "GEMINI_MODEL"),
    )

    sentry_dsn: str = Field(default="", validation_alias="SENTRY_DSN")

    # বাংলা মন্তব্য: OLLAMA_URL — fail-fast, কোনো localhost fallback নেই
    ollama_url: str = Field(default="", validation_alias="OLLAMA_URL")

    gcp_project_id: str = Field(default="", validation_alias="GCP_PROJECT_ID")
    gcp_region: str = Field(default="us-central1", validation_alias="GCP_REGION")

    # বাংলা মন্তব্য: Filesystem paths
    admin_rules_db: str = Field(default="", validation_alias="ADMIN_RULES_DB_PATH")
    memory_db_dir: str = Field(default="", validation_alias="MEMORY_DB_DIR")
    skill_registry_path: str = Field(default="", validation_alias="SKILL_REGISTRY_PATH")
    # বাংলা মন্তব্য: ChromaDB ভেক্টর ডাটাবেসের জন্য কনফিগারেবল পাথ যোগ করা হলো।
    chromadb_path: str = Field(default="supremeai_knowledge_base", validation_alias="CHROMADB_PATH")

    # ── Sandbox config — env-driven ──────────────────────────────────────────
    workspace_base_dir: str = Field(
        default="/tmp/supremeai_workspace",
        validation_alias="WORKSPACE_BASE_DIR",
        description="Base directory for user workspace files (api/routes/files.py)",
    )
    sandbox_root: str = Field(default="/tmp/sandboxes", validation_alias="SANDBOX_ROOT")  # nosec B108
    firecracker_path: str = Field(
        default="/usr/bin/firecracker", validation_alias="FIRECRACKER_PATH"
    )
    gvisor_path: str = Field(default="/usr/bin/runsc", validation_alias="GVISOR_PATH")
    allow_sandbox_fallback: bool = Field(default=False, validation_alias="ALLOW_SANDBOX_FALLBACK")
    # বাংলা মন্তব্য: local_code_executor ও docker_sandbox-এর লোকাল ফলব্যাকের জন্য settings ভেরিয়েবল যোগ করা হলো।
    allow_local_sandbox_fallback: str = Field(
        default="false", validation_alias="ALLOW_LOCAL_SANDBOX_FALLBACK"
    )

    # ── Agent Execution Config — env-driven ─────────────────────────────────
    # বাংলা মন্তব্য: আগে agent_orchestrator.py সরাসরি os.getenv() করত।
    # এখন এই দুটো settings-এর Single Source of Truth থেকে আসে।
    max_agent_tokens: int = Field(default=5000, validation_alias="MAX_AGENT_TOKENS")
    max_agent_iterations: int = Field(default=5, validation_alias="MAX_AGENT_ITERATIONS")
    agent_admin_permissions_required: bool = Field(
        default=True, validation_alias="AGENT_ADMIN_PERMISSIONS_REQUIRED"
    )

    # ── LLM Cost Config — env-driven ────────────────────────────────────────
    # বাংলা মন্তব্য: আগে llm_gateway.py-এ `estimated_cost = tokens * 0.00001` hardcoded ছিল।
    # এখন এই factor settings থেকে নিয়ন্ত্রিত হয় যা runtime-এ override করা যাবে।
    llm_cost_per_token: float = Field(default=0.00001, validation_alias="LLM_COST_PER_TOKEN")

    # ── Task Queue Config — env-driven ──────────────────────────────────────
    # বাংলা মন্তব্য: task_queue_enhanced.py-এ TTL এবং backend priority এখন config-driven।
    task_result_ttl_seconds: int = Field(default=3600, validation_alias="TASK_RESULT_TTL_SECONDS")
    queue_backend_priority: str = Field(
        default="asyncio,redis,celery,pubsub", validation_alias="QUEUE_BACKEND_PRIORITY"
    )

    # ── Health Check Config — env-driven ────────────────────────────────────
    # বাংলা মন্তব্য: health_monitor.py-এ hardcoded interval এখন config-driven।
    health_check_interval_seconds: int = Field(
        default=60, validation_alias="HEALTH_CHECK_INTERVAL_SECONDS"
    )
    skill_timeout_seconds: int = Field(default=30, validation_alias="SKILL_TIMEOUT_SECONDS")
    # Issue #513 (BE-07): default True — a production deploy missing REDIS_URL
    # must fail fast instead of silently degrading security invariants
    # (rate-limiting falls back to per-instance in-memory, token revocation
    # becomes fail-open for non-admin tokens, idempotency keys per-instance).
    # Operators explicitly opt out only for single-instance prod deploys via
    # REDIS_REQUIRED_FOR_PRODUCTION=false. Dev/test are unaffected: the
    # consumer (startup/services.py::_init_redis) only enforces this in
    # env=production.
    redis_required_for_production: bool = Field(
        default=True, validation_alias="REDIS_REQUIRED_FOR_PRODUCTION"
    )

    # ── Self-Healing Config — env-driven ────────────────────────────────────
    self_heal_approval_webhook: str = Field(
        default="", validation_alias="SELF_HEAL_APPROVAL_WEBHOOK"
    )
    self_heal_approval_timeout_hours: int = Field(
        default=24, validation_alias="SELF_HEAL_APPROVAL_TIMEOUT_HOURS"
    )
    auto_remediation_dry_run: bool = Field(
        default=True, validation_alias="AUTO_REMEDIATION_DRY_RUN"
    )

    # ── Migrated Runtime Environment Fields ──────────────────────────────────
    db_slow_query_threshold: float = Field(default=0.2, validation_alias="DB_SLOW_QUERY_THRESHOLD")
    token_juice_enabled: bool = Field(default=True, validation_alias="TOKEN_JUICE_ENABLED")
    enable_evolution_learning: bool = Field(
        default=False, validation_alias="ENABLE_EVOLUTION_LEARNING"
    )
    # #1939: merge-learning signal weights (config-driven, no magic numbers).
    # When enable_evolution_learning=True, the evolution tick reads
    # merge_learning_reports and feeds these signals into FitnessEngine.
    merge_learning_lookback_days: int = Field(
        default=7, validation_alias="MERGE_LEARNING_LOOKBACK_DAYS"
    )
    merge_learning_hold_penalty: float = Field(
        default=1.0, validation_alias="MERGE_LEARNING_HOLD_PENALTY"
    )
    merge_learning_clean_reward: float = Field(
        default=0.5, validation_alias="MERGE_LEARNING_CLEAN_REWARD"
    )
    voice_didi_confidence: float = Field(default=0.6, validation_alias="VOICE_DIDI_CONFIDENCE")
    voice_didi_max_duration: int = Field(default=30, validation_alias="VOICE_DIDI_MAX_DURATION")
    voice_didi_intents: str = Field(
        default="search,order,help,price,location,cancel,repeat",
        validation_alias="VOICE_DIDI_INTENTS",
    )
    bhasha_cache_ttl_hours: int = Field(default=24, validation_alias="BHASHA_CACHE_TTL_HOURS")
    bhasha_min_quality: float = Field(default=0.7, validation_alias="BHASHA_MIN_QUALITY")
    bhasha_max_cache: int = Field(default=10000, validation_alias="BHASHA_MAX_CACHE")
    bhasha_batch_concurrency: int = Field(default=5, validation_alias="BHASHA_BATCH_CONCURRENCY")

    # ── Microservices Config — env-driven ─────────────────────────────────────
    # বাংলা মন্তব্য: Scraper microservic-এর লিভ সেনেন, Cloudflare Worker থেকে proxy করে।
    scraper_service_url: str = Field(default="", validation_alias="SCRAPER_SERVICE_URL")
    # Media microservic-এর URL (Cloud Run)
    media_service_url: str = Field(default="", validation_alias="MEDIA_SERVICE_URL")

    # ── Core App Endpoints (Frontend/Backend Canonical Routing) ───────────────
    user_backend_url: str = Field(default="", validation_alias="USER_BACKEND_URL")
    admin_backend_url: str = Field(default="", validation_alias="ADMIN_BACKEND_URL")
    websocket_url: str = Field(default="", validation_alias="WEBSOCKET_URL")

    # ── Telegram Bot & Alerts Config ──────────────────────────────────────────
    telegram_bot_token: str = Field(default="", validation_alias="TELEGRAM_BOT_TOKEN")
    admin_telegram_chat_id: str = Field(default="", validation_alias="ADMIN_TELEGRAM_CHAT_ID")

    # ── Automation & Vendor Independence Config ───────────────────────────────
    automation_enabled: bool = Field(default=True, validation_alias="AUTOMATION_ENABLED")
    storage_provider: str = Field(default="postgres", validation_alias="STORAGE_PROVIDER")
    messaging_provider: str = Field(default="existing", validation_alias="MESSAGING_PROVIDER")

    # n8n
    n8n_enabled: bool = Field(default=False, validation_alias="N8N_ENABLED")
    n8n_base_url: str = Field(default="", validation_alias="N8N_BASE_URL")
    n8n_timeout_seconds: int = Field(default=15, validation_alias="N8N_TIMEOUT_SECONDS")
    n8n_max_retries: int = Field(default=3, validation_alias="N8N_MAX_RETRIES")
    n8n_verify_tls: bool = Field(default=True, validation_alias="N8N_VERIFY_TLS")
    n8n_event_delivery_enabled: bool = Field(
        default=False, validation_alias="N8N_EVENT_DELIVERY_ENABLED"
    )

    # Appwrite
    appwrite_enabled: bool = Field(default=False, validation_alias="APPWRITE_ENABLED")
    appwrite_endpoint: str = Field(default="", validation_alias="APPWRITE_ENDPOINT")
    appwrite_project_id: str = Field(default="", validation_alias="APPWRITE_PROJECT_ID")
    appwrite_timeout_seconds: int = Field(default=10, validation_alias="APPWRITE_TIMEOUT_SECONDS")

    # ── Missing Config Variables from env check ───────────────────────────────
    resend_from_email: str = Field(
        default="noreply@supremeai.dev", validation_alias="RESEND_FROM_EMAIL"
    )
    retry_budget_max_tokens: int = Field(default=20, validation_alias="RETRY_BUDGET_MAX_TOKENS")
    retry_budget_refill_rate: float = Field(
        default=1.0, validation_alias="RETRY_BUDGET_REFILL_RATE"
    )
    runpod_api_url: str = Field(default="", validation_alias="RUNPOD_API_URL")
    sandbox_payload: str = Field(default="", validation_alias="SANDBOX_PAYLOAD")
