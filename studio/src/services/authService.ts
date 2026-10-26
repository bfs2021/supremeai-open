// Authentication Service for SupremeAI 2.0 (Zero-Firebase / Native Auth)
// বাংলা মন্তব্য: এটি পিওর নেটিভ অ্যাডমিন লগইন ও টিওটিপি অথেন্টিকেশন সার্ভিস প্রোভাইড করে।

import { apiClient } from './apiClient';
import { clearTrustedBrowserToken, getTrustedBrowserToken, setTrustedBrowserToken } from './tokenStorage';

export const authService = {
  // Native (zero-firebase) admin auth endpoints
  adminLogin: async (email: string, password: string): Promise<{ status: string; token?: string; uid?: string; email?: string }> => {
    const trustedBrowserToken = getTrustedBrowserToken();
    const response = await apiClient.post<{ status: string; token?: string; access_token?: string; jwt?: string; uid?: string; email?: string }>(
      '/api/admin/login',
      { email, password, trusted_browser_token: trustedBrowserToken || undefined }
    );
    return { ...response, token: response.token ?? response.access_token ?? response.jwt };
  },

  // বাংলা: DB-backed trusted-browser পুনঃপ্রবেশ — ৭ দিনের মেয়াদের মধ্যে
  // ব্রাউজার ডাটাবেসে সেভ থাকলে email/password/code ছাড়াই admin JWT।
  // সার্ভারই একমাত্র যাচাইকারী — ক্লায়েন্টে কোনো trust shortcut নেই।
  adminTrustedBrowserLogin: async (trustedBrowserToken: string): Promise<{ status: string; token?: string; email?: string }> => {
    const response = await apiClient.post<{ status: string; token?: string; access_token?: string; jwt?: string; email?: string }>(
      '/api/admin/login',
      { trusted_browser_token: trustedBrowserToken }
    );
    return { ...response, token: response.token ?? response.access_token ?? response.jwt };
  },

  adminTotpVerify: async (otp: string, rememberBrowser = false): Promise<{ status: string; token: string; trusted_browser_token?: string }> => {
    const response = await apiClient.post<{ status: string; token: string; trusted_browser_token?: string }>(
      '/api/admin/totp-verify',
      { otp, remember_browser: rememberBrowser }
    );
    if (response.trusted_browser_token) {
      setTrustedBrowserToken(response.trusted_browser_token);
    }
    return response;
  },

  adminTotpSetup: async (): Promise<{ secret: string; provisioning_uri: string; recovery_codes?: string[] }> => {
    return apiClient.post<{ secret: string; provisioning_uri: string; recovery_codes?: string[] }>('/api/admin/totp-setup', {});
  },

  adminLogout: async (): Promise<void> => {
    try {
      await apiClient.post('/api/admin/logout', {});
    } catch {
      // best-effort
    }
  },

  revokeTrustedBrowser: async (): Promise<void> => {
    const raw = getTrustedBrowserToken();
    try {
      // বাংলা: কাঁচা টোকেনের ধারকই বৈধ মালিক — উপস্থাপন করে প্রত্যাহার।
      await apiClient.delete('/api/admin/trusted-browsers', {
        headers: raw ? { 'X-Trusted-Browser-Token': raw } : undefined,
      } as RequestInit);
    } catch {
      // best-effort
    }
    clearTrustedBrowserToken();
  },
};
