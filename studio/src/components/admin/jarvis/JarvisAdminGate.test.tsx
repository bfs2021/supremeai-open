import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JarvisAdminGate } from './JarvisAdminGate';

const { adminTotpVerify, adminTrustedBrowserLogin } = vi.hoisted(() => ({
  adminTotpVerify: vi.fn(),
  adminTrustedBrowserLogin: vi.fn(),
}));

// বাংলা: gate এখন সার্ভার-যাচাইকৃত — লোকাল TOTP/PIN/QR-seed কিছুই নেই,
// তাই authService মক করাই যথেষ্ট।
vi.mock('../../../services/authService', () => ({
  authService: {
    adminTotpVerify,
    adminTrustedBrowserLogin,
  },
}));

describe('JarvisAdminGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('unlocks silently when the DB-backed trusted browser token is server-valid', async () => {
    const onUnlocked = vi.fn();
    localStorage.setItem('supreme_trusted_browser_token', 'raw-trusted-token');
    adminTrustedBrowserLogin.mockResolvedValue({ status: 'trusted_browser', token: 'jwt' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    await waitFor(() => {
      expect(adminTrustedBrowserLogin).toHaveBeenCalledWith('raw-trusted-token');
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
    // বাংলা: code ছাড়া প্রবেশ শুধুই সার্ভার-যাচাইয়ের পর — কোনো ক্লায়েন্ট শর্টকাট নেই।
    expect(adminTotpVerify).not.toHaveBeenCalled();
  });

  it('stays locked when the trusted browser token is server-rejected (expired)', async () => {
    const onUnlocked = vi.fn();
    localStorage.setItem('supreme_trusted_browser_token', 'stale-token');
    adminTrustedBrowserLogin.mockRejectedValue({ message: 'expired' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    await waitFor(() => {
      expect(adminTrustedBrowserLogin).toHaveBeenCalled();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('000 000')).toBeInTheDocument();
  });

  it('unlocks with a server-verified 6-digit code and auto-submits upon 6 digits', async () => {
    const onUnlocked = vi.fn();
    adminTotpVerify.mockResolvedValue({ status: 'success', token: 'admin-jwt' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    const input = screen.getByPlaceholderText('000 000');
    fireEvent.change(input, { target: { value: '123456' } });

    await waitFor(() => {
      expect(adminTotpVerify).toHaveBeenCalledWith('123456', true);
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT unlock with the old emergency PIN 1955 — the server rejects it', async () => {
    const onUnlocked = vi.fn();
    adminTotpVerify.mockRejectedValue({ message: 'Invalid authentication code.' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    const input = screen.getByPlaceholderText('000 000');
    // ৪-ডিজিট PIN আর কোনো শর্টকাট নয় — সরাসরি সার্ভারে যায় এবং প্রত্যাখ্যাত হয়
    fireEvent.change(input, { target: { value: '1955' } });
    fireEvent.click(screen.getByRole('button', { name: /AUTHENTICATE/i }));

    await waitFor(() => {
      expect(adminTotpVerify).toHaveBeenCalled();
    });
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('shows server error message on incorrect code', async () => {
    const onUnlocked = vi.fn();
    adminTotpVerify.mockRejectedValue({ message: 'Invalid authentication code.' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    const input = screen.getByPlaceholderText('000 000');
    fireEvent.change(input, { target: { value: '999999' } });

    await waitFor(() => {
      expect(screen.getByText(/Invalid authentication code/i)).toBeInTheDocument();
      expect(onUnlocked).not.toHaveBeenCalled();
    });
  });

  it('surfaces a server-side error when TOTP is not configured (fail-closed)', async () => {
    const onUnlocked = vi.fn();
    adminTotpVerify.mockRejectedValue({ message: 'TOTP secret not configured.' });

    render(<JarvisAdminGate onUnlocked={onUnlocked} />);

    fireEvent.change(screen.getByPlaceholderText('000 000'), { target: { value: '111111' } });

    await waitFor(() => {
      expect(screen.getByText(/TOTP secret not configured/i)).toBeInTheDocument();
      expect(onUnlocked).not.toHaveBeenCalled();
    });
  });
});
