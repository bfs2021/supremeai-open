"""Tests for Native Admin Auth (Zero-Firebase).

Verifies:
- POST /api/admin/login (validation, credential checking, direct vs TOTP flow)
- POST /api/admin/totp-setup (secret generation & provisioning URI)
- POST /api/admin/totp-verify (valid vs invalid TOTP code, JWT issuance)
- POST /api/admin/logout (session cleanup)
- GET  /api/admin/me (Bearer token verification)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add repo root and gateway dir to sys.path for portable discovery
_GATEWAY_DIR = next(
    (
        p
        for p in Path(__file__).resolve().parents
        if (p / "main.py").is_file() and (p / "routing_policy.json").is_file()
    ),
    None,
)
if _GATEWAY_DIR is not None:
    if str(_GATEWAY_DIR) not in sys.path:
        sys.path.insert(0, str(_GATEWAY_DIR))
    if str(_GATEWAY_DIR.parent) not in sys.path:
        sys.path.insert(0, str(_GATEWAY_DIR.parent))

try:
    from tests.test_streaming_gateway import base_config
except ImportError:
    from gateway.tests.test_streaming_gateway import base_config

try:
    from main import create_app
except ImportError:
    from gateway.main import create_app

try:
    from admin_auth import (
        check_totp,
        generate_totp_secret,
        issue_admin_jwt,
        verify_admin_jwt,
    )
except ImportError:
    from gateway.admin_auth import (
        check_totp,
        generate_totp_secret,
        issue_admin_jwt,
        verify_admin_jwt,
    )


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("ADMIN_EMAIL", "admin@supremeai.com")
    monkeypatch.setenv("SUPREMEAI_ADMIN_PASSWORD", "secret123")
    monkeypatch.setenv("ADMIN_ENFORCE_TOTP", "false")
    monkeypatch.setenv("SUPREMEAI_JWT_SECRET", "test-jwt-secret-for-native-admin-tests")

    app = create_app(config=base_config())
    return TestClient(app)



def _compute_totp(secret: str) -> str:
    """Compute a valid RFC 6238 code for a base32 secret (shared test helper)."""
    import base64
    import hashlib
    import hmac
    import struct
    import time

    clean_secret = secret.strip().upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)
    key = base64.b32decode(clean_secret)
    current_time = int(time.time() // 30)
    msg = struct.pack(">Q", current_time)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[19] & 15
    code_num = struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code_num % 1000000:06d}"


def test_native_jwt_roundtrip(monkeypatch):
    monkeypatch.setenv("SUPREMEAI_JWT_SECRET", "test-secret")
    token = issue_admin_jwt(uid="admin-123", email="admin@supremeai.com", role="admin")
    payload = verify_admin_jwt(token)
    assert payload["sub"] == "admin-123"
    assert payload["email"] == "admin@supremeai.com"
    assert payload["role"] == "admin"


def test_rfc6238_totp_check():
    secret = generate_totp_secret()
    # TOTP with invalid code fails
    assert not check_totp("000000", secret)
    # TOTP with empty code fails
    assert not check_totp("", secret)


def test_admin_login_missing_fields(client):
    res = client.post("/api/admin/login", json={})
    assert res.status_code == 422 or res.status_code == 400


def test_admin_login_invalid_credentials(client):
    res = client.post("/api/admin/login", json={"email": "admin@supremeai.com", "password": "wrongpassword"})
    assert res.status_code == 401
    assert "Invalid admin credentials" in res.json().get("detail", "")


def test_admin_login_success_direct(client):
    res = client.post("/api/admin/login", json={"email": "admin@supremeai.com", "password": "secret123"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "authenticated"
    assert "token" in data
    assert data["role"] == "admin"

    # Verify the issued token works with /me
    me_res = client.get("/api/admin/me", headers={"Authorization": f"Bearer {data['token']}"})
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["status"] == "ok"
    assert me_data["admin"]["role"] == "admin"


def test_admin_totp_setup_and_verify_flow(client, monkeypatch):
    monkeypatch.setenv("ADMIN_ENFORCE_TOTP", "true")
    monkeypatch.delenv("SUPREMEAI_ADMIN_TOTP_SECRET", raising=False)

    # 1. Login prompts setup when no secret is configured
    login_res = client.post("/api/admin/login", json={"email": "admin@supremeai.com", "password": "secret123"})
    assert login_res.status_code == 200
    assert login_res.json()["status"] == "totp_setup_required"

    # 2. Setup returns secret & provisioning URI
    setup_res = client.post("/api/admin/totp-setup")
    assert setup_res.status_code == 200
    setup_data = setup_res.json()
    assert setup_data["status"] == "ok"
    assert "secret" in setup_data
    assert "otpauth://" in setup_data["provisioning_uri"]
    assert len(setup_data["recovery_codes"]) == 4

    # 3. Invalid verify code rejected
    bad_verify = client.post("/api/admin/totp-verify", json={"otp": "999999"})
    assert bad_verify.status_code == 401

    # 4. Valid verify code with newly generated setup secret succeeds
    import base64
    import hashlib
    import hmac
    import struct
    import time
    clean_secret = setup_data["secret"].strip().upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)
    key = base64.b32decode(clean_secret)
    current_time = int(time.time() // 30)
    msg = struct.pack(">Q", current_time)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[19] & 15
    code_num = struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF
    valid_otp = f"{code_num % 1000000:06d}"

    good_verify = client.post("/api/admin/totp-verify", json={"otp": valid_otp})
    assert good_verify.status_code == 200
    assert good_verify.json()["status"] == "success"
    assert "token" in good_verify.json()


def test_admin_logout(client):
    res = client.post("/api/admin/logout")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_trusted_browser_full_lifecycle(client, monkeypatch):
    import base64
    import hashlib
    import hmac
    import struct
    import time

    monkeypatch.setenv("ADMIN_ENFORCE_TOTP", "true")
    monkeypatch.delenv("SUPREMEAI_ADMIN_TOTP_SECRET", raising=False)

    # 1. Initiate setup
    setup_res = client.post("/api/admin/totp-setup")
    assert setup_res.status_code == 200
    secret = setup_res.json()["secret"]

    # Calculate valid OTP
    clean_secret = secret.strip().upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)
    key = base64.b32decode(clean_secret)
    current_time = int(time.time() // 30)
    msg = struct.pack(">Q", current_time)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[19] & 15
    code_num = struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF
    valid_otp = f"{code_num % 1000000:06d}"

    # 2. Verify with remember_browser=True
    verify_res = client.post(
        "/api/admin/totp-verify",
        json={"otp": valid_otp, "remember_browser": True},
    )
    assert verify_res.status_code == 200
    data = verify_res.json()
    assert data["status"] == "success"
    assert "trusted_browser_token" in data
    trusted_token = data["trusted_browser_token"]
    admin_token = data["token"]

    # Verify cookie was set
    assert "supreme_admin_trusted_browser" in verify_res.cookies

    # 3. Next login with trusted_browser_token in body bypasses TOTP!
    login_res = client.post(
        "/api/admin/login",
        json={
            "email": "admin@supremeai.com",
            "password": "secret123",
            "trusted_browser_token": trusted_token,
        },
    )
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert login_data["status"] == "trusted_browser"
    assert "token" in login_data

    # 4. Login with X-Trusted-Browser header bypasses TOTP!
    header_res = client.post(
        "/api/admin/login",
        json={"email": "admin@supremeai.com", "password": "secret123"},
        headers={"X-Trusted-Browser": trusted_token},
    )
    assert header_res.status_code == 200
    assert header_res.json()["status"] == "trusted_browser"

    # 5. List trusted browsers
    list_res = client.get(
        "/api/admin/trusted-browsers",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert list_res.status_code == 200
    browsers = list_res.json().get("browsers", [])
    assert len(browsers) >= 1
    browser_id = browsers[0]["id"]

    # 6. Revoke trusted browser
    del_res = client.delete(
        f"/api/admin/trusted-browsers/{browser_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_res.status_code == 200
    assert del_res.json()["revoked"] is True

    # 7. Login after revocation prompts for TOTP again!
    revoked_login = client.post(
        "/api/admin/login",
        json={
            "email": "admin@supremeai.com",
            "password": "secret123",
            "trusted_browser_token": trusted_token,
        },
    )
    assert revoked_login.status_code == 200
    assert revoked_login.json()["status"] in ("otp_required", "totp_setup_required")




# ── Code-only gate + DB-backed trust (SQLite persistence) ────────────────────
# বাংলা: user dashboard থেকে admin-এ ঢুকতে শুধু authentication code; ৭-দিন
# trust ডাটাবেসে থাকে (restart-প্রতিরোধী); কোনো bypass নেই — fail-closed।


def _fresh_setup_otp(client) -> str:
    """Fresh TOTP enrollment → compute a valid OTP from the pending secret.

    বাংলা: টেস্ট-নিরোধক (isolation) — pending setup cache-ই একমাত্র সত্য,
    অন্য টেস্টের env/secret অবস্থার উপর নির্ভর করে না।
    """
    setup = client.post("/api/admin/totp-setup")
    assert setup.status_code == 200
    return _compute_totp(setup.json()["secret"])


def test_trusted_browser_code_free_reentry_without_credentials(client):
    # 1. First entry: code is mandatory (remember_browser=true → DB trust)
    first = client.post(
        "/api/admin/totp-verify",
        json={"otp": _fresh_setup_otp(client), "remember_browser": True},
    )
    assert first.status_code == 200
    raw_token = first.json()["trusted_browser_token"]

    # 2. Re-entry with ONLY the trusted token — no email, no password
    re_entry = client.post("/api/admin/login", json={"trusted_browser_token": raw_token})
    assert re_entry.status_code == 200
    re_data = re_entry.json()
    assert re_data["status"] == "trusted_browser"
    assert re_data["role"] == "admin"

    # 3. The issued JWT is a real admin JWT
    me = client.get("/api/admin/me", headers={"Authorization": f"Bearer {re_data['token']}"})
    assert me.status_code == 200
    assert me.json()["admin"]["role"] == "admin"


def test_trusted_browser_unknown_token_fail_closed(client):
    # Unknown token + no credentials → 401, never a JWT (no bypass)
    bad = client.post("/api/admin/login", json={"trusted_browser_token": "not-a-real-token"})
    assert bad.status_code == 401
    assert "expired" in bad.json().get("detail", "").lower() or "invalid" in bad.json().get("detail", "").lower()


def test_totp_verify_without_remember_issues_no_trust(client):
    res = client.post(
        "/api/admin/totp-verify",
        json={"otp": _fresh_setup_otp(client), "remember_browser": False},
    )
    assert res.status_code == 200
    assert "trusted_browser_token" not in res.json()


def test_trusted_browser_revoke_via_raw_token_header(client):
    first = client.post(
        "/api/admin/totp-verify",
        json={"otp": _fresh_setup_otp(client), "remember_browser": True},
    )
    raw_token = first.json()["trusted_browser_token"]

    # Possession of the raw token = right to revoke (LOCK button path)
    revoke = client.delete(
        "/api/admin/trusted-browsers",
        headers={"X-Trusted-Browser-Token": raw_token},
    )
    assert revoke.status_code == 200
    assert revoke.json()["revoked"] is True

    # Revoked token no longer re-enters — fail-closed
    re_entry = client.post("/api/admin/login", json={"trusted_browser_token": raw_token})
    assert re_entry.status_code == 401


def test_trusted_browser_revoke_requires_token_or_bearer(client):
    res = client.delete("/api/admin/trusted-browsers")
    assert res.status_code == 401
