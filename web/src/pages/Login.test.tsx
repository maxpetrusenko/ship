import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './Login';

const navigate = vi.fn();
const login = vi.fn();
const getSearchParam = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: null }),
  useSearchParams: () => [{
    get: getSearchParam,
  }],
}));

vi.mock('@/components/icons/uswds', () => ({
  Icon: ({ title }: { title?: string }) => <span>{title ?? 'icon'}</span>,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    login.mockReset();
    login.mockResolvedValue({ success: false, error: 'Login failed' });
    navigate.mockReset();
    getSearchParam.mockReset();
    getSearchParam.mockReturnValue(null);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      success: true,
      data: { needsSetup: false, available: false },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as Response);
  });

  it('associates email validation errors with an email-specific alert id', async () => {
    // Risk mitigated: sign-in failures need field-specific announcements so keyboard and screen-reader users know what to fix.
    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('id', 'login-email-error');
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('aria-describedby', 'login-email-error');
  });

  it('associates password validation errors with a password-specific alert id', async () => {
    // Risk mitigated: empty-password failures should not be announced as a generic login error tied to the wrong field.
    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'dev@ship.local' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('id', 'login-password-error');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('aria-describedby', 'login-password-error');
  });
});
