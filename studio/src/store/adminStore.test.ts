import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventBus, Events } from '../lib/componentEventBus';

const { adminLogin, adminTrustedBrowserLogin, adminTotpVerify, adminLogout } = vi.hoisted(() => ({
  adminLogin: vi.fn(),
  adminTrustedBrowserLogin: vi.fn(),
  adminTotpVerify: vi.fn(),
  adminLogout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/authService', () => ({
  authService: {
    adminLogin,
    adminTrustedBrowserLogin,
    adminTotpVerify,
    adminLogout,
  },
}));

import { useAdminStore } from './adminStore';
const reset = () =>
  useAdminStore.setState({
    adminAuthenticated: false,
    adminRole: null,
    adminError: '',
    actionStatus: '',
    adminSubTab: 'dashboard',
    adminEmail: '',
    otpRequired: false,
    adminOtp: '',
    rememberBrowser: false,
    totpSetupRequired: false,
    totpSecret: '',
    provisioningUri: '',
  });

const makeJwt = (payloadObj: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
  return `${header}.${payload}.sig1234567890abcdef`;
};

describe('adminStore (Zero Firebase / Native Auth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    reset();
  });

  it('sets scalar admin fields', () => {
    useAdminStore.getState().setAdminRole('superadmin');
    useAdminStore.getState().setAdminError('err');
    useAdminStore.getState().setActionStatus('busy');
    useAdminStore.getState().setAdminSubTab('users');
    useAdminStore.getState().setAdminEmail('a@b.com');
    useAdminStore.getState().setOtpRequired(true);
    useAdminStore.getState().setAdminOtp('123456');
    useAdminStore.getState().setRememberBrowser(true);
    useAdminStore.getState().setTotpSetupRequired(true);
    useAdminStore.getState().setTotpSecret('secret');
    useAdminStore.getState().setProvisioningUri('uri');
    const s = useAdminStore.getState();
    expect(s.adminRole).toBe('superadmin');
    expect(s.adminError).toBe('err');
    expect(s.actionStatus).toBe('busy');
    expect(s.adminSubTab).toBe('users');
    expect(s.adminEmail).toBe('a@b.com');
    expect(s.otpRequired).toBe(true);
    expect(s.adminOtp).toBe('123456');
    expect(s.rememberBrowser).toBe(true);
    expect(s.totpSetupRequired).toBe(true);
    expect(s.totpSecret).toBe('secret');
    expect(s.provisioningUri).toBe('uri');
  });

  it('returns early when the authentication code is not exactly 6 digits', async () => {
    useAdminStore.setState({ adminOtp: '12' });
    await useAdminStore.getState().handleAdminLogin();
    expect(adminTotpVerify).not.toHaveBeenCalled();
    expect(useAdminStore.getState().adminError).toContain('6 digits');
  });

  it('authenticates after server-verified TOTP code (code-only gate)', async () => {
    useAdminStore.setState({ adminOtp: '123456' });
    const token = makeJwt({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
    adminTotpVerify.mockResolvedValue({ token });
    await useAdminStore.getState().handleAdminLogin();
    const s = useAdminStore.getState();
    expect(adminTotpVerify).toHaveBeenCalledWith('123456', false);
    expect(s.adminAuthenticated).toBe(true);
    expect(s.adminRole).toBe('admin');
    expect(sessionStorage.getItem('supreme_admin_jwt')).toBe(token);
    expect(localStorage.getItem('supreme_admin_jwt')).toBe(token);
  });

  it('records an error when TOTP verification fails', async () => {
    useAdminStore.setState({ adminOtp: '000000' });
    adminTotpVerify.mockRejectedValue({ message: 'invalid code' });
    await useAdminStore.getState().handleAdminLogin();
    expect(useAdminStore.getState().adminError).toContain('invalid code');
    expect(useAdminStore.getState().adminAuthenticated).toBe(false);
  });

  it('silently re-enters via DB-backed trusted browser token', async () => {
    const token = makeJwt({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem('supreme_trusted_browser_token', 'raw-trusted-token');
    adminTrustedBrowserLogin.mockResolvedValue({ status: 'trusted_browser', token });

    const ok = await useAdminStore.getState().tryTrustedBrowser();

    expect(ok).toBe(true);
    expect(adminTrustedBrowserLogin).toHaveBeenCalledWith('raw-trusted-token');
    expect(useAdminStore.getState().adminAuthenticated).toBe(true);
    expect(useAdminStore.getState().adminRole).toBe('admin');
    expect(sessionStorage.getItem('supreme_admin_jwt')).toBe(token);
  });

  it('fail-closed: clears the trusted token and returns false when the server rejects it', async () => {
    localStorage.setItem('supreme_trusted_browser_token', 'stale-token');
    adminTrustedBrowserLogin.mockRejectedValue({ message: 'expired' });

    const ok = await useAdminStore.getState().tryTrustedBrowser();

    expect(ok).toBe(false);
    expect(useAdminStore.getState().adminAuthenticated).toBe(false);
    expect(localStorage.getItem('supreme_trusted_browser_token')).toBeNull();
  });

  it('returns false immediately when no trusted browser token exists', async () => {
    const ok = await useAdminStore.getState().tryTrustedBrowser();
    expect(ok).toBe(false);
    expect(adminTrustedBrowserLogin).not.toHaveBeenCalled();
  });

  it('logs out, clears tokens and emits AUTH_LOGOUT', async () => {
    let emitted = false;
    const handler = () => {
      emitted = true;
    };
    eventBus.on(Events.AUTH_LOGOUT, handler);
    localStorage.setItem('supreme_admin_jwt', 'x');
    sessionStorage.setItem('supreme_admin_jwt', 'x');
    await useAdminStore.getState().handleAdminLogout();
    expect(localStorage.getItem('supreme_admin_jwt')).toBeNull();
    expect(sessionStorage.getItem('supreme_admin_jwt')).toBeNull();
    expect(adminLogout).toHaveBeenCalled();
    expect(emitted).toBe(true);
    expect(useAdminStore.getState().adminAuthenticated).toBe(false);
  });
});
