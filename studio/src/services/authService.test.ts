import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { authService } from './authService';
import { apiClient } from './apiClient';

describe('authService (Native / Zero-Firebase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adminLogin posts email and password', async () => {
    (apiClient.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      token: 'admin-jwt-token',
      uid: 'admin-1',
      email: 'admin@supremeai.com',
    });
    const res = await authService.adminLogin('admin@supremeai.com', 'secret');
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/login', {
      email: 'admin@supremeai.com',
      password: 'secret',
    });
    expect(res.token).toBe('admin-jwt-token');
  });

  it('adminTotpSetup posts to /api/admin/totp-setup', async () => {
    (apiClient.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      secret: 's3cr3t',
      provisioning_uri: 'otpauth://...',
      recovery_codes: ['code1'],
    });
    const res = await authService.adminTotpSetup();
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/totp-setup', {});
    expect(res.secret).toBe('s3cr3t');
  });

  it('adminTotpVerify posts otp and remember_browser flag', async () => {
    (apiClient.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      token: 'verified-jwt',
    });
    const res = await authService.adminTotpVerify('123456');
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/totp-verify', {
      otp: '123456',
      remember_browser: false,
    });
    expect(res.token).toBe('verified-jwt');

    await authService.adminTotpVerify('123456', true);
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/totp-verify', {
      otp: '123456',
      remember_browser: true,
    });
  });

  it('adminTrustedBrowserLogin posts only the trusted_browser_token (code-free re-entry)', async () => {
    (apiClient.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'trusted_browser',
      token: 'fast-jwt',
    });
    const res = await authService.adminTrustedBrowserLogin('raw-browser-token');
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/login', {
      trusted_browser_token: 'raw-browser-token',
    });
    expect(res.status).toBe('trusted_browser');
    expect(res.token).toBe('fast-jwt');
  });

  it('revokeTrustedBrowser sends the raw token via header', async () => {
    (apiClient.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    localStorage.setItem('supreme_trusted_browser_token', 'raw-browser-token');
    await authService.revokeTrustedBrowser();
    expect(apiClient.delete).toHaveBeenCalledWith(
      '/api/admin/trusted-browsers',
      expect.objectContaining({ headers: { 'X-Trusted-Browser-Token': 'raw-browser-token' } })
    );
    expect(localStorage.getItem('supreme_trusted_browser_token')).toBeNull();
  });

  it('adminLogout posts to /api/admin/logout', async () => {
    (apiClient.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await authService.adminLogout();
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/logout', {});
  });
});
