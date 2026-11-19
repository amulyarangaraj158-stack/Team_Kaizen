import React, { useState } from 'react';
import { Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { apiFetch, User } from '../lib/api';
import { useAppStore } from '../store/useAppStore';

export function AuthPage() {
  const setSession = useAppStore((s) => s.setSession);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('engineer@autopatch.ai');
  const [password, setPassword] = useState('AutoPatch#2026');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, name };
      const res = await apiFetch<{ user: User; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSession(res.user, res.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/demo-session', {
        method: 'POST',
      });
      setSession(res.user, res.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open starter workspace.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cyber-grid-bg flex min-h-screen items-center justify-center p-4">
      <div className="cyber-panel-elevated cyber-glow-cyan w-full max-w-md rounded-xl p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#00F5FF]/40 bg-[#00F5FF]/10 text-[#00F5FF]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-[#F1F5F9]">AutoPatch AI</h1>
            <p className="text-xs text-[#94A3B8]">Autonomous Bug Detection & Repair Command Centre</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-md border border-[#00F5FF]/15 bg-[#070B14] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            className={`rounded py-2 text-xs font-semibold transition-colors ${
              mode === 'login' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError('');
            }}
            className={`rounded py-2 text-xs font-semibold transition-colors ${
              mode === 'register' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-[#94A3B8]">
                Full Name
              </label>
              <div className="relative mt-1">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  className="w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] py-2.5 pl-9 pr-3 text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-[#94A3B8]">
              Email Address
            </label>
            <div className="relative mt-1">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] py-2.5 pl-9 pr-3 text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-[#94A3B8]">
              Password
            </label>
            <div className="relative mt-1">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                id="auth-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] py-2.5 pl-9 pr-3 text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 p-3 text-xs text-[#FF3864]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#00F5FF] px-4 py-2.5 text-sm font-semibold text-[#070B14] transition-colors hover:bg-[#33f7ff] disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-5 border-t border-[#00F5FF]/15 pt-4">
          <button
            type="button"
            onClick={handleDemo}
            disabled={loading}
            className="w-full rounded-md border border-[#00F5FF]/25 bg-[#101A2B] px-4 py-2 text-xs font-medium text-[#F1F5F9] transition-colors hover:bg-[#142238]"
          >
            Continue with Starter Workspace (engineer@autopatch.ai)
          </button>
        </div>
      </div>
    </div>
  );
}
