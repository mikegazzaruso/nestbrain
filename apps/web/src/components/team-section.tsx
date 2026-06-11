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
  ArrowRight,
  Lock,
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
  // Show the upsell by default; reveal the connect form on demand (or when a
  // server was remembered from a previous session).
  const [showConnect, setShowConnect] = useState(false);
  const [switching, setSwitching] = useState(false);

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
      // Electron wraps IPC errors ("Error invoking remote method '…': Error:
      // NEEDS_SETUP"), so match the sentinel as a substring, not by equality.
      if (msg.includes("NEEDS_SETUP")) setNeedsSetup(true); // fresh server → provision first admin
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
          showConnect ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-muted/60 leading-relaxed">
                Connect to your company&apos;s NestBrain Team Server.
              </p>
              <button onClick={() => setShowConnect(false)} className="text-[11px] text-muted/50 hover:text-foreground shrink-0">
                ← back
              </button>
            </div>
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
            <UpsellCard onConnect={() => setShowConnect(true)} />
          )
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-green-400/90">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Connected · <span className="font-mono text-muted/60">{state?.serverUrl}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSwitching((v) => !v)}
                  className="text-[11px] text-muted/50 hover:text-foreground transition-colors"
                >
                  Switch server…
                </button>
                <button
                  onClick={() => window.nestbrain?.team.disconnect()}
                  className="flex items-center gap-1.5 text-[11px] text-muted/50 hover:text-red-400 transition-colors"
                >
                  <LogOut size={12} /> Sign out
                </button>
              </div>
            </div>

            {switching && (
              <SwitchServerPanel currentUrl={state?.serverUrl} onDone={() => setSwitching(false)} />
            )}

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

            <p className="text-[11px] text-muted/50 leading-relaxed">
              Edited the same file as a teammate? Both versions are kept — theirs lands next to
              yours as <code className="text-accent/70 bg-accent/5 px-1 rounded">*.conflict-…</code>;
              merge what you need, then delete the copy. Nothing is ever silently overwritten.
            </p>

            {/* Nests this member is entitled to (besides the global knowledge) */}
            {(state?.workspaces ?? []).some((w) => w.isGlobal === false) && (
              <div>
                <p className="text-[11px] text-muted/50 uppercase tracking-wider mb-2">Your Nests</p>
                <div className="flex flex-wrap gap-2">
                  {(state?.workspaces ?? [])
                    .filter((w) => w.isGlobal === false)
                    .map((w) => (
                      <span
                        key={w.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-[11px] text-violet-200"
                        title={`Synced to Library/Knowledge/Nests/${w.name}`}
                      >
                        {w.name}
                        <span className={`text-[9px] px-1 py-px rounded-full ${w.role === "reader" ? "bg-amber-500/15 text-amber-300" : "bg-green-500/15 text-green-300"}`}>
                          {w.role === "reader" ? "read-only" : "writer"}
                        </span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            <MembersBlock
              members={members}
              // Only the CURRENT user being an admin gates add/remove — not
              // "some member is an admin" (always true → everyone saw Add).
              // The server also enforces this (requireAdmin on /members).
              isAdmin={state?.user?.role === "admin"}
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

function UpsellCard({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-accent flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0">
          <Users size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Share knowledge across your team</p>
          <p className="text-[12px] text-muted/60 leading-relaxed mt-0.5">
            Compile once, share with everyone. Your team&apos;s knowledge base syncs in real time on a server
            {" "}<b className="text-foreground/80">you</b> control — your data, your infrastructure.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 text-[12px] text-muted/70">
        <li className="flex items-center gap-2"><Check size={13} className="text-green-400/70 shrink-0" /> Real-time sync of your compiled knowledge across the team</li>
        <li className="flex items-center gap-2"><Server size={13} className="text-accent/60 shrink-0" /> Self-hosted on your own server — full data sovereignty</li>
        <li className="flex items-center gap-2"><Lock size={13} className="text-accent/60 shrink-0" /> Members, seats and access managed by your admin</li>
      </ul>

      <div className="flex items-center gap-3 pt-1">
        <a
          href="https://nestbrain.app"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-br from-violet-500 to-accent text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-violet-500/20"
        >
          Get Enterprise <ArrowRight size={14} />
        </a>
        <button onClick={onConnect} className="text-[12px] text-muted/60 hover:text-foreground transition-colors">
          I already have a Team Server →
        </button>
      </div>
    </div>
  );
}

function SwitchServerPanel({ currentUrl, onDone }: { currentUrl?: string; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSwitch() {
    setBusy(true);
    setError(null);
    try {
      await window.nestbrain!.team.switch(url.trim(), email.trim(), password);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "switch failed");
    }
    setBusy(false);
  }

  return (
    <div className="p-4 rounded-lg bg-background border border-amber-500/25 space-y-3">
      <p className="text-[11px] text-amber-300/90 leading-relaxed">
        <b>Switching servers replaces this device&apos;s team knowledge.</b> You&apos;ll be
        disconnected from <span className="font-mono">{currentUrl}</span>, the synced{" "}
        <code className="bg-amber-500/10 px-1 rounded">Library/Knowledge</code> and{" "}
        <code className="bg-amber-500/10 px-1 rounded">Team/</code> folders are removed from this
        device (the old server keeps everything; your Projects/ are untouched), then the new
        server&apos;s knowledge is pulled. Done in the safe order — nothing is deleted remotely.
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://team.other-company.com" className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm font-mono focus:outline-none focus:border-accent/50" />
      <div className="grid grid-cols-2 gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-accent/50" />
      </div>
      <label className="flex items-start gap-2 text-[11px] text-muted/70 cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-amber-400" />
        I understand the team knowledge on this device will be replaced.
      </label>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={doSwitch}
          disabled={busy || !confirmed || !url.trim() || !email.trim() || !password}
          className="px-4 py-2 bg-amber-500/90 hover:bg-amber-400 text-background text-xs font-medium rounded-lg transition-colors disabled:opacity-40 flex items-center gap-2"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Switch server
        </button>
        <button onClick={onDone} className="text-[11px] text-muted/60 hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}
