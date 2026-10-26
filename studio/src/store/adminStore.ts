import { create } from 'zustand';
import { authService } from '../services/authService';
import { updateTokenCache } from '../services/apiClient';
import {
  clearAdminToken,
  clearTrustedBrowserToken,
  getAdminToken,
  getTrustedBrowserToken,
  setAdminToken,
} from '../services/tokenStorage';
import { LEGACY_ADMIN_TOKEN_KEY } from './authStore';
import { eventBus, Events } from '../lib/componentEventBus';

const decodeJwt = (token: string): Record<string, unknown> | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    const decoded = JSON.parse(jsonPayload);

    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Decoded JWT payload is not a valid object');
    }

    return decoded;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.warn("⚠️ [JWT_DECODE_ERROR]: Failed to safely parse admin JWT token.", {
      error_message: e?.message || 'Malformed JWT structure',
      timestamp: new Date().toISOString(),
    });
    return null;
  }
};

// বাংলা: buildProvisioningUri সরানো হয়েছে — QR setup UI এখন আর code-only
// gate-এর অংশ নয়; TOTP secret env/vault (SUPREMEAI_ADMIN_TOTP_SECRET) থেকেই আসে।

const persistAdminToken = (token: unknown): token is string => {
  if (typeof token !== 'string' || token.trim().length < 20) return false;
  setAdminToken(token);
  updateTokenCache(token);
  return true;
};

interface AdminState {
  adminAuthenticated: boolean;
  adminRole: string | null;
  setAdminRole: (val: string | null) => void;
  adminError: string;
  setAdminError: (val: string) => void;
  // বাংলা: code-only gate — authentication code ছাড়া প্রবেশ নেই।
  // ১ম বার code দেওয়া বাধ্যতামূলক; ৭-দিন মনে-রাখো চালু থাকলে সেটি
  // ডাটাবেসে সেভ হয় এবং মেয়াদের মধ্যে tryTrustedBrowser নীরবে ঢুকিয়ে দেয়।
  handleAdminLogin: () => Promise<void>;
  tryTrustedBrowser: () => Promise<boolean>;
  handleAdminLogout: () => void;
  actionStatus: string;
  setActionStatus: (val: string) => void;
  adminSubTab: string;
  setAdminSubTab: (tab: string) => void;
  adminEmail: string;
  setAdminEmail: (val: string) => void;
  otpRequired: boolean;
  setOtpRequired: (val: boolean) => void;
  adminOtp: string;
  setAdminOtp: (val: string) => void;
  rememberBrowser: boolean;
  setRememberBrowser: (val: boolean) => void;
  totpSetupRequired: boolean;
  setTotpSetupRequired: (val: boolean) => void;
  totpSecret: string;
  setTotpSecret: (val: string) => void;
  provisioningUri: string;
  setProvisioningUri: (val: string) => void;
  resetTotpSetup: () => Promise<void>;
}

const getInitialAdminToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return getAdminToken();
  } catch (err) {
    console.warn('[adminStore] initial admin token read failed, using fallback:', err);
    return null;
  }
};

const initialToken = getInitialAdminToken();
const initialDecoded = initialToken ? decodeJwt(initialToken) : null;
const isInitialTokenValid = Boolean(
  initialDecoded &&
  typeof initialDecoded.exp === 'number' &&
  initialDecoded.exp * 1000 > Date.now()
);

if (isInitialTokenValid && initialToken) {
  updateTokenCache(initialToken);
}

export const useAdminStore = create<AdminState>((set, get) => ({
  adminAuthenticated: isInitialTokenValid,
  adminRole: isInitialTokenValid && initialDecoded?.role === 'admin' ? 'admin' : null,
  setAdminRole: (val) => set({ adminRole: val }),
  adminError: '',
  setAdminError: (val) => set({ adminError: val }),
  actionStatus: '',
  setActionStatus: (val) => set({ actionStatus: val }),
  adminSubTab: 'dashboard',
  setAdminSubTab: (tab) => set({ adminSubTab: tab }),
  adminEmail: '',
  setAdminEmail: (val) => set({ adminEmail: val }),
  otpRequired: false,
  setOtpRequired: (val) => set({ otpRequired: val }),
  adminOtp: '',
  setAdminOtp: (val) => set({ adminOtp: val }),
  rememberBrowser: false,
  setRememberBrowser: (val) => set({ rememberBrowser: val }),
  totpSetupRequired: false,
  setTotpSetupRequired: (val) => set({ totpSetupRequired: val }),
  totpSecret: '',
  setTotpSecret: (val) => set({ totpSecret: val }),
  provisioningUri: '',
  setProvisioningUri: (val) => set({ provisioningUri: val }),
  // বাংলা: আগের recoverTotp লোকাল mock টোকেন বানাত (bypass) — পুরোপুরি বাদ।
  // Bypass নেই: প্রথমবার অবশ্যই ৬-ডিজিট authentication code দিতে হবে।
  handleAdminLogin: async () => {
    const { adminOtp, rememberBrowser } = get();
    const cleanOtp = adminOtp.trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      set({ adminError: 'Authentication code must be exactly 6 digits.' });
      return;
    }
    set({ adminError: '' });

    try {
      // বাংলা: সার্ভারই একমাত্র যাচাইকারী। rememberBrowser=true হলে সার্ভার
      // ব্রাউজার-টোকেন ডাটাবেসে ৭ দিনের মেয়াদে সেভ করে; authService সেটি
      // সংরণ করে — পরেরবার tryTrustedBrowser নীরবে প্রবেশ করাবে।
      const data = await authService.adminTotpVerify(cleanOtp, rememberBrowser);
      if (!persistAdminToken(data.token)) {
        set({ adminError: 'Authentication token missing. Please sign in again.' });
        return;
      }
      const decoded = decodeJwt(data.token);
      if (decoded && typeof decoded.role === 'string') {
        set({ adminRole: decoded.role });
      }

      eventBus.emit(Events.AUTH_LOGIN, {
        source: 'admin_store',
        timestamp: Date.now(),
      });

      set({ adminAuthenticated: true, otpRequired: false, totpSetupRequired: false, adminOtp: '' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (verifyErr: any) {
      const errStr = typeof verifyErr?.message === 'string' ? verifyErr.message : 'Invalid authentication code.';
      set({ adminError: errStr });
    }
  },

  // বাংলা: নীরব পুনঃপ্রবেশ — DB-ব্যাকড trusted-browser টোকেন সার্ভারে যাচাই।
  // বৈধ হলে admin JWT, অবৈধ/মেয়াদোত্তীর্ণ হলে টোকেন মুছে false — fail-closed।
  tryTrustedBrowser: async () => {
    const trusted = getTrustedBrowserToken();
    if (!trusted) return false;
    try {
      const data = await authService.adminTrustedBrowserLogin(trusted);
      if (data.status === 'trusted_browser' && typeof data.token === 'string' && persistAdminToken(data.token)) {
        const decoded = decodeJwt(data.token);
        eventBus.emit(Events.AUTH_LOGIN, {
          source: 'admin_store_trusted_browser',
          timestamp: Date.now(),
        });
        set({
          adminAuthenticated: true,
          adminRole: decoded?.role === 'admin' ? 'admin' : null,
          adminError: '',
          otpRequired: false,
        });
        return true;
      }
    } catch {
      // টোকেন অবৈধ/মেয়াদোত্তীর্ণ — নিচে মুছে ফেলা হয়; gate আবার code চাইবে।
    }
    clearTrustedBrowserToken();
    return false;
  },
  handleAdminLogout: async () => {
    try {
      await authService.adminLogout();
      localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
      clearAdminToken();
      updateTokenCache(null);

      eventBus.emit(Events.AUTH_LOGOUT, {
        source: 'admin_store',
        timestamp: Date.now()
      });
    } catch(e) {
      console.error('Logout failed:', e);
    }
    set({ adminAuthenticated: false, adminRole: null, otpRequired: false, adminOtp: '', adminError: '', totpSetupRequired: false, totpSecret: '', provisioningUri: '' });
  },
  resetTotpSetup: async () => {
    // Return cleanly to password view and clear pending OTP locks
    set({
      otpRequired: false,
      totpSetupRequired: false,
      adminOtp: '',
      adminError: '',
      totpSecret: '',
      provisioningUri: '',
    });
  },
}));
