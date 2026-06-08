"use client";

import { useCallback, useEffect, useState } from "react";
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
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";

export function TeamSection() {
  const [state, setState] = useState<TeamState | null>(null);
  const [supported, setSupported] = useState(true);
  const [members, setMembers] = useState<TeamMember[]>([]);

  // connect form
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // First-run provisioning of a fresh server.
  const [needsSetup, setNeedsSetup] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain?.team) {
      setSupported(false);
      return;
    }
    window.nestbrain.team.getState().then(setState).catch(() => {});
    const off = window.nestbrain.team.onStateChanged((s) => setState(s));
    return () => off?.();
  }, []);

  const loadMembers = useCallback(async () => {
    if (!window.nestbrain?.team) return;
    try { setMembers(await window.nestbrain.team.listMembers()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (state?.status === "connected") {
      loadMembers();
      if (!url && state.serverUrl) setUrl(state.serverUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.status]);

  if (!supported) return null;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await window.nestbrain!.team.connect(url.trim(), email.trim(), password);
      setPassword("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "connection failed";
      if (msg === "NEEDS_SETUP") setNeedsSetup(true); // fresh server → provision first admin
      else setError(msg);
    }
    setBusy(false);
  }

  async function doSetup() {
    setBusy(true);
    setError(null);
    try {
      await window.nestbrain!.team.setup(url.trim(), token.trim(), email.trim(), password);
      setPassword("");
      setToken("");
      setNeedsSetup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "setup failed");
    }
    setBusy(false);
  }

  async function syncNow() {
    setSyncMsg(null);
    setError(null);
    try {
      const r = await window.nestbrain!.team.syncNow();
      if (r) setSyncMsg(`↑${r.uploaded} ↓${r.downloaded}${r.conflicts ? ` · ${r.conflicts} conflict(s)` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "sync failed");
    }
  }

  const connected = state?.status === "connected";

  return (
    <section className="mb-10">
      <h2 className="text-sm font-medium text-muted/70 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Users size={14} /> Team Knowledge
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 normal-case tracking-normal font-medium">
          Enterprise
        </span>
      </h2>

      <div className="p-5 rounded-xl bg-card border border-border space-y-4">
        {!connected ? (
          <>
            <p className="text-[12px] text-muted/60 leading-relaxed">
              Share your knowledge base with your team on a server you control. Connect to your
              company&apos;s NestBrain Team Server.
            </p>
            <div>
              <label className="block text-xs text-muted/70 mb-2">Team Server URL</label>
              <div className="relative">
                <Server size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/40" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://team.acme.com"
                  className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-lg text-sm font-mono text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
            {needsSetup && (
              <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
                Fresh server — create the first admin. Paste the <b>setup token</b> printed in the server logs.
              </p>
            )}
            {needsSetup && (
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="setup token"
                className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-mono focus:outline-none focus:border-accent/50"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={needsSetup ? "admin email" : "you@acme.com"} className="px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (needsSetup ? doSetup() : connect())} placeholder={needsSetup ? "admin password" : "password"} className="px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
            </div>
            <button
              onClick={needsSetup ? doSetup : connect}
              disabled={busy || !url.trim() || !email.trim() || !password || (needsSetup && !token.trim())}
              className="px-5 py-2 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {needsSetup ? "Create admin & connect" : "Connect"}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-green-400/90">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Connected · <span className="font-mono text-muted/60">{state?.serverUrl}</span>
              </div>
              <button
                onClick={() => window.nestbrain?.team.disconnect()}
                className="flex items-center gap-1.5 text-[11px] text-muted/50 hover:text-red-400 transition-colors"
              >
                <LogOut size={12} /> Sign out
              </button>
            </div>

            {state?.license && <LicenseBadge license={state.license} usedSeats={members.length} />}

            {/* Workspaces */}
            <div>
              <p className="text-[11px] text-muted/50 uppercase tracking-wider mb-2">Workspace</p>
              {(state?.workspaces ?? []).length > 1 ? (
                <select
                  value={state?.workspaceId ?? ""}
                  onChange={(e) => window.nestbrain?.team.selectWorkspace(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50"
                >
                  {state?.workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-sm">
                  <Users size={13} className="text-accent/60" />
                  {state?.workspaces?.[0]?.name ?? "—"}
                </div>
              )}
            </div>

            {/* Sync */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-muted/50 min-w-0 truncate flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400/70 shrink-0" title="Auto-sync on" />
                {state?.syncing
                  ? "Syncing…"
                  : syncMsg
                    ? <span className="text-green-400/80">{syncMsg}</span>
                    : state?.lastSync
                      ? `Auto-sync on · last ${new Date(state.lastSync).toLocaleTimeString()}`
                      : "Auto-sync on"}
              </div>
              <button
                onClick={syncNow}
                disabled={state?.syncing}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40 shrink-0"
                title="Sync Library/Knowledge with the team workspace"
              >
                {state?.syncing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpDown size={14} />}
                Sync now
              </button>
            </div>

            <MembersBlock
              members={members}
              isAdmin={state?.user?.role === "admin" || members.some((m) => m.role === "admin")}
              onChanged={loadMembers}
            />
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

function LicenseBadge({ license, usedSeats }: { license: NonNullable<TeamState["license"]>; usedSeats?: number }) {
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
      await window.nestbrain!.team.addMember({ ...form, email: form.email.trim(), role: "member" });
      setForm({ email: "", name: "", password: "" });
      setAdding(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-muted/50 uppercase tracking-wider">Members ({members.length})</p>
        <div className="flex items-center gap-3">
          <button onClick={onChanged} className="text-muted/40 hover:text-foreground" title="Refresh"><RefreshCw size={12} /></button>
          {isAdmin && !adding && (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover">
              <UserPlus size={12} /> Add
            </button>
          )}
        </div>
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
                onClick={async () => { await window.nestbrain!.team.removeMember(m.id); onChanged(); }}
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
