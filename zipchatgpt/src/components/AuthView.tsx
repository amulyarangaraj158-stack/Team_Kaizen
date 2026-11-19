import React, { useState } from 'react';
import { ArrowLeft, Loader2, KeyRound, ShieldCheck } from 'lucide-react';
import { apiRequest, setStoredToken } from '../lib/api';
import type { User } from '../types';

interface AuthViewProps {
  initialMode?: 'login' | 'register';
  onBack: () => void;
  onAuthenticated: (user: User) => void;
}

export function AuthView({ initialMode = 'login', onBack, onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Software Engineer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fillDemoAccount = () => {
    setMode('login');
    setEmail('demo@autopatch.dev');
    setPassword('DemoPass123!');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login' ? { email, password } : { name, role, email, password };
      const data = await apiRequest<{ user: User; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setStoredToken(data.token);
      onAuthenticated(data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col">
      <header className="px-6 h-16 border-b border-[#151E33] flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Overview
        </button>
        <span className="text-base font-bold font-display text-white">AutoPatch AI</span>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#0C1324] border border-[#1B2742] rounded-xl p-7 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white font-display">
                {mode === 'login' ? 'Sign in to AutoPatch AI' : 'Create developer account'}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {mode === 'login'
                  ? 'Access your projects, scan history, and safe repair workspace.'
                  : 'Passwords are protected with salted crypto.scrypt hashing.'}
              </p>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#080D19] border border-[#18233C] rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 text-xs font-medium rounded-md transition-colors ${
                mode === 'login' ? 'bg-[#172340] text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 text-xs font-medium rounded-md transition-colors ${
                mode === 'register' ? 'bg-[#172340] text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Patel"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Engineering Role</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Full-Stack Developer"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.dev"
                className="w-full px-3.5 py-2.5 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3.5 py-2.5 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'Sign In to Workspace' : 'Create Account'}
            </button>
          </form>

          {/* Demo Account Quick-Fill */}
          <div className="mt-6 pt-5 border-t border-[#18233C]">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                <p className="font-medium text-slate-200 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-violet-400" />
                  Demo Account Ready
                </p>
                <p className="font-mono text-[11px] text-slate-500 mt-0.5">
                  demo@autopatch.dev · DemoPass123!
                </p>
              </div>
              <button
                type="button"
                onClick={fillDemoAccount}
                className="px-3 py-1.5 text-xs font-medium text-blue-300 bg-[#131E36] hover:bg-[#1B2B4B] border border-[#24365C] rounded-lg transition-colors whitespace-nowrap"
              >
                Quick Fill
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              Pre-loaded with sample JavaScript and Python repositories for immediate exploration.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
