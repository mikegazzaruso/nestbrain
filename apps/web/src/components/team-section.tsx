"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Loader2,
  AlertCircle,
  Check,
  LogOut,
  Server,
  Trash2,
  UserPlus,
  ShieldCheck,
} from "lucide-react";
import {
  health,
  login,
  logout,
  isLoggedIn,
  teamUrl,
  setServerUrl,
  listWorkspaces,
  listMembers,
  addMember,
  removeMember,
  TeamError,
  type TeamWorkspace,
  type TeamMember,
  type TeamLicense,
} from "@/lib/team";

type Phase = "connect" | "login" | "ready";

export function TeamSection() {
  const [phase, setPhase] = useState<Phase>("connect");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [license, setLicense] = useState<TeamLicense | null>(null);
  const [workspaces, setWorkspaces] = useState<TeamWorkspace[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    const saved = teamUrl();
    if (saved) setUrl(saved);
    if (isLoggedIn()) {
      setPhase("ready");
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setError(null);
    try {
      const [h, ws, mem] = await Promise.all([health(teamUrl()), listWorkspaces(), listMembers()]);
      setLicense(h.license);
      setWorkspaces(ws);
      setMembers(mem);
      setPhase("ready");
    } catch (e) {
      if (e instanceof TeamError && e.status === 401) {
        handleLogout();
      } else {
        setError(e instanceof Error ? e.message : "failed to load");
      }
    }
  }

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const clean = url.trim().replace(/\/$/, "");
      const h = await health(clean);
      setServerUrl(clean);
      setLicense(h.license);
      setPhase("login");
    } catch {
      setError("Could not reach a Team Server at that address.");
    }
    setBusy(false);
  }

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await login(email.trim(), password);
      setMe({ email: user.email, role: user.role });
      setPassword("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    }
    setBusy(false);
  }

  function handleLogout() {
    logout();
    setMembers([]);
    setWorkspaces([]);
    setMe(null);
    setPhase("login");
  }

  return (
    <section className="mb-10">
      <h2 className="text-sm font-medium text-muted/70 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Users size={14} /> Team Knowledge
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 normal-case tracking-normal font-medium">
          Enterprise
        </span>
      </h2>

      <div className="p-5 rounded-xl bg-card border border-border space-y-4">
        {phase === "connect" && (
          <>
            <p className="text-[12px] text-muted/60 leading-relaxed">
              Share your knowledge base with your team on a server you control. Enter your
              company&apos;s NestBrain Team Server address to get started.
            </p>
            <div>
              <label className="block text-xs text-muted/70 mb-2">Team Server URL</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Server size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/40" />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://team.acme.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-lg text-sm font-mono text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                  />
                </div>
                <button
                  onClick={handleConnect}
                  disabled={busy || !url.trim()}
                  className="px-4 py-2.5 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  Connect
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "login" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted/60 font-mono truncate">{teamUrl()}</span>
              <button onClick={() => setPhase("connect")} className="text-[11px] text-muted/50 hover:text-foreground">
                change
              </button>
            </div>
            {license && <LicenseBadge license={license} />}
            <div className="grid grid-cols-2 gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@acme.com"
                className="px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/50"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="password"
                className="px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <button
              onClick={handleLogin}
              disabled={busy || !email.trim() || !password}
              className="px-5 py-2 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              Sign in
            </button>
          </>
        )}

        {phase === "ready" && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-green-400/90">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Connected · <span className="font-mono text-muted/60">{teamUrl()}</span>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-1.5 text-[11px] text-muted/50 hover:text-red-400 transition-colors">
                <LogOut size={12} /> Sign out
              </button>
            </div>
            {license && <LicenseBadge license={license} usedSeats={members.length} />}

            <div>
              <p className="text-[11px] text-muted/50 uppercase tracking-wider mb-2">Workspaces</p>
              <div className="space-y-1">
                {workspaces.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-sm">
                    <Users size={13} className="text-accent/60" />
                    {w.name}
                  </div>
                ))}
              </div>
            </div>

            <MembersBlock
              members={members}
              isAdmin={me?.role === "admin" || members.some((m) => m.role === "admin")}
              onChanged={refresh}
            />

            <p className="text-[11px] text-muted/40 leading-relaxed pt-1 border-t border-border/50">
              Content sync of your <code className="text-accent/60 bg-accent/5 px-1 rounded">Library/Knowledge</code> with this
              team workspace is wired next.
            </p>
          </>
        )}

        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} /> {error}
          </p>
        )}
      </div>
    </section>
  );
}

function LicenseBadge({ license, usedSeats }: { license: TeamLicense; usedSeats?: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted/70 bg-background border border-border rounded-lg px-3 py-2">
      <ShieldCheck size={13} className={license.dev ? "text-amber-400" : "text-green-400"} />
      <span>
        {license.dev ? "Dev license" : `Licensed to ${license.org}`} ·{" "}
        {usedSeats != null ? `${usedSeats}/${license.seats}` : license.seats} seats
        {license.exp ? ` · expires ${new Date(license.exp * 1000).toLocaleDateString()}` : ""}
      </span>
    </div>
  );
}

function MembersBlock({
  members,
  isAdmin,
  onChanged,
}: {
  members: TeamMember[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await addMember({ ...form, email: form.email.trim(), role: "member" });
      setForm({ email: "", name: "", password: "" });
      setAdding(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof TeamError && e.status === 402 ? e.message : e instanceof Error ? e.message : "failed");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-muted/50 uppercase tracking-wider">Members ({members.length})</p>
        {isAdmin && !adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover">
            <UserPlus size={12} /> Add
          </button>
        )}
      </div>

      <div className="space-y-1">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-sm group">
            <div className="w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[10px] font-medium shrink-0">
              {(m.name || m.email).slice(0, 2).toUpperCase()}
            </div>
            <span className="flex-1 truncate">{m.name || m.email}</span>
            {m.role === "admin" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">admin</span>}
            {isAdmin && m.role !== "admin" && (
              <button
                onClick={async () => { await removeMember(m.id); onChanged(); }}
                className="opacity-0 group-hover:opacity-100 text-muted/40 hover:text-red-400 transition-all"
                title="Remove member"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-2 p-3 rounded-lg bg-background border border-border space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email" className="px-2.5 py-2 bg-card border border-border rounded text-xs focus:outline-none focus:border-accent/50" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="name" className="px-2.5 py-2 bg-card border border-border rounded text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="temporary password" className="w-full px-2.5 py-2 bg-card border border-border rounded text-xs focus:outline-none focus:border-accent/50" />
          {err && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertCircle size={11} /> {err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setErr(null); }} className="px-3 py-1.5 text-xs text-muted hover:text-foreground">Cancel</button>
            <button onClick={add} disabled={busy || !form.email.trim() || !form.password} className="px-3 py-1.5 bg-accent text-background text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-40 flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Add member
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
