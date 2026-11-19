import React, { useEffect } from 'react';
import { LogOut, RefreshCw, Shield, Terminal, User as UserIcon } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export function SettingsPage() {
  const { user, health, fetchHealth, logout } = useAppStore();

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Settings & Infrastructure</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Workspace account profile, live service diagnostics, security safeguards, and deployment environment reference.
        </p>
      </div>

      {/* Account Profile */}
      <section className="cyber-panel rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#A855F7]/20 text-[#A855F7]">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#F1F5F9]">{user?.name}</h2>
              <p className="font-mono text-xs text-[#94A3B8]">
                {user?.email} · {user?.role}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-2 rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 px-4 py-2 text-xs font-semibold text-[#FF3864] hover:bg-[#FF3864]/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </section>

      {/* Live Backend Health & AI Provider Status */}
      <section className="cyber-panel space-y-4 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#F1F5F9]">Runtime Service Configuration</h2>
          <button
            type="button"
            onClick={() => fetchHealth()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/25 bg-[#142238] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:text-[#00F5FF]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Probes
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {health &&
            Object.entries(health.services).map(([key, svc]) => (
              <div key={key} className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-[#F1F5F9]">{key}</span>
                  <span
                    className={`font-mono text-xs font-semibold ${
                      svc.status === 'operational'
                        ? 'text-[#39FF88]'
                        : svc.status === 'unconfigured'
                          ? 'text-[#FFB020]'
                          : 'text-[#FF3864]'
                    }`}
                  >
                    {svc.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-[#94A3B8]">{svc.detail}</p>
              </div>
            ))}
        </div>
      </section>

      {/* Active Security Safeguards */}
      <section className="cyber-panel space-y-3 rounded-lg p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#39FF88]" />
          <h2 className="text-base font-semibold text-[#F1F5F9]">Active Security Architecture</h2>
        </div>
        <ul className="grid grid-cols-1 gap-2.5 text-xs text-[#94A3B8] sm:grid-cols-2">
          <li className="rounded bg-[#0B1220] p-3">
            <strong className="text-[#F1F5F9]">Authentication & Ownership:</strong> bcrypt password hashing + signed JWT Bearer enforcement on all workspace routes.
          </li>
          <li className="rounded bg-[#0B1220] p-3">
            <strong className="text-[#F1F5F9]">Isolated Sandbox Execution:</strong> Regression Guardian executes candidate tests in ephemeral temp directories with stripped environment secrets and 8s timeouts.
          </li>
          <li className="rounded bg-[#0B1220] p-3">
            <strong className="text-[#F1F5F9]">Website Debugger SSRF Defense:</strong> Blocks localhost, private IPv4/IPv6 ranges, cloud metadata IPs, DNS rebinding, and unsafe redirects.
          </li>
          <li className="rounded bg-[#0B1220] p-3">
            <strong className="text-[#F1F5F9]">Upload & Path Hardening:</strong> Path traversal sanitization, MIME whitelisting, 2MB code & 15MB media caps, and API rate limiting.
          </li>
        </ul>
      </section>

      {/* Server Environment Variable Reference */}
      <section className="cyber-panel space-y-3 rounded-lg p-5">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#00F5FF]" />
          <h2 className="text-base font-semibold text-[#F1F5F9]">Server Environment & Secrets Reference</h2>
        </div>
        <p className="text-xs text-[#94A3B8]">
          Secrets are injected exclusively on the server side (never in browser code). Configure environment variables in your host platform or the Secrets panel:
        </p>
        <pre className="overflow-x-auto rounded-md border border-[#00F5FF]/15 bg-[#070B14] p-4 font-mono text-xs text-[#00F5FF]">
{`GEMINI_API_KEY   # Server-side Google Gemini API key (configured via Secrets panel)
GEMINI_MODEL     # Optional model override (default: gemini-4-hydrogen)
JWT_SECRET       # Strong random secret for signing JWT sessions
DATABASE_PATH    # SQLite file location (default: ./data/autopatch.db)
CORS_ORIGIN      # Comma-separated allowed origins`}
        </pre>
      </section>
    </div>
  );
}
