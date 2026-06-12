"use client";

import { useEffect, useState } from "react";
import { Blocks, FolderGit2, Brain } from "lucide-react";
import { useModules } from "@/lib/modules-context";
import { useT } from "@/lib/app-i18n";

// Module Settings — one card per ACTIVE module, each hosting its own
// configuration. Modules are Enterprise add-ons: this page only exists in
// the nav when at least one is licensed.

// Icons + product names are not localized; taglines come from t.team.modulesPage.
const CATALOG: Record<string, { icon: React.ReactNode; name: string }> = {
  dev: { icon: <FolderGit2 size={20} />, name: "Dev" },
  anatomize: { icon: <Brain size={20} />, name: "Anatomize" },
};

export default function ModulesPage() {
  const { modules, loaded } = useModules();
  const { t } = useT();

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <Blocks size={22} className="text-accent" />
        <h1 className="text-xl font-semibold">{t.team.modulesPage.title}</h1>
      </div>
      <p className="text-sm text-muted mb-8">
        {t.team.modulesPage.subtitle}
      </p>

      {loaded && modules.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted">
          {t.team.modulesPage.none}
        </div>
      )}

      <div className="space-y-5">
        {modules.map((id) => {
          const meta = CATALOG[id] ?? { icon: <Blocks size={20} />, name: id };
          const tagline =
            (t.team.modulesPage.taglines as Record<string, string>)[id] ??
            t.team.modulesPage.fallbackTagline;
          return (
            <div key={id} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border bg-card-hover/40">
                <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  {meta.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-[15px]">{meta.name}</h2>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                      {t.team.modulesPage.activeBadge}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted/70 leading-snug">{tagline}</p>
                </div>
              </div>
              <div className="px-6 py-5">
                {id === "dev" ? (
                  <DevModuleSettings />
                ) : id === "anatomize" ? (
                  <AnatomizeModuleSettings />
                ) : (
                  <p className="text-xs text-muted/60">{t.team.modulesPage.noSettings}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DevModuleSettings() {
  const { t } = useT();
  const [team, setTeam] = useState<TeamState | null>(null);

  useEffect(() => {
    const mn = typeof window !== "undefined" ? window.nestbrain : undefined;
    if (!mn?.team) return;
    void mn.team.getState().then(setTeam);
    return mn.team.onStateChanged(setTeam);
  }, []);

  const connected = team?.status === "connected";
  const on = team?.includeProjects ?? false;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{t.team.modulesPage.includeProjects}</p>
        <p className="text-[11px] text-muted/60 leading-relaxed mt-0.5">
          {t.team.modulesPage.includeDesc1} <code className="text-accent/70 bg-accent/5 px-1 rounded">Projects/</code>{" "}
          {t.team.modulesPage.includeDesc2} <b className="text-amber-300/90">{t.team.modulesPage.includeDescEveryone}</b>{" "}
          {t.team.modulesPage.includeDesc3}{" "}
          <code className="text-accent/70 bg-accent/5 px-1 rounded">.git</code> {t.team.modulesPage.includeDesc4}
          {!connected && (
            <span className="block mt-1 text-amber-300/70">
              {t.team.modulesPage.requiresConnection}
            </span>
          )}
        </p>
      </div>
      <button
        disabled={!connected}
        onClick={() => void window.nestbrain?.team.setIncludeProjects(!on)}
        className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? "bg-accent" : "bg-border"}`}
      >
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform ${on ? "left-[22px]" : "left-[3px]"}`} />
      </button>
    </div>
  );
}

interface CompanyContext {
  companyType: "startup_innovativa" | "neoimpresa" | "pmi" | "consolidata";
  sector: string;
  stage: string;
  employees: string;
  notes: string;
  autoAssess: boolean;
}

const EMPTY_CTX: CompanyContext = {
  companyType: "pmi",
  sector: "",
  stage: "",
  employees: "",
  notes: "",
  autoAssess: false,
};

const inputCls =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/60 transition-colors";

function AnatomizeModuleSettings() {
  const { t } = useT();
  const tc = t.anatomize.context;
  const [ctx, setCtx] = useState<CompanyContext>(EMPTY_CTX);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    void fetch("/api/anatomize/context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const c = (d as { context?: CompanyContext | null } | null)?.context;
        if (c) setCtx(c);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setStatus("saving");
    try {
      const r = await fetch("/api/anatomize/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
      });
      if (!r.ok) throw new Error();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  };

  const TYPES: { id: CompanyContext["companyType"]; label: string }[] = [
    { id: "startup_innovativa", label: tc.typeStartup },
    { id: "neoimpresa", label: tc.typeNew },
    { id: "pmi", label: tc.typePmi },
    { id: "consolidata", label: tc.typeEstablished },
  ];

  return (
    <div>
      <p className="text-sm font-medium">{tc.title}</p>
      <p className="text-[11px] text-muted/60 leading-relaxed mt-0.5 mb-4">{tc.subtitle}</p>

      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-2">{tc.type}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {TYPES.map((ty) => (
          <button
            key={ty.id}
            onClick={() => setCtx({ ...ctx, companyType: ty.id })}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              ctx.companyType === ty.id
                ? "border-accent/60 bg-accent/10 text-foreground"
                : "border-border bg-background text-muted hover:border-accent/30 hover:text-foreground"
            }`}
          >
            {ty.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-1.5">{tc.sector}</p>
          <input className={inputCls} value={ctx.sector} placeholder={tc.sectorPh} onChange={(e) => setCtx({ ...ctx, sector: e.target.value })} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-1.5">{tc.stage}</p>
          <input className={inputCls} value={ctx.stage} placeholder={tc.stagePh} onChange={(e) => setCtx({ ...ctx, stage: e.target.value })} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-1.5">{tc.employees}</p>
          <input className={inputCls} value={ctx.employees} placeholder={tc.employeesPh} onChange={(e) => setCtx({ ...ctx, employees: e.target.value })} />
        </div>
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-1.5">{tc.notes}</p>
      <textarea
        className={`${inputCls} resize-none`}
        rows={3}
        value={ctx.notes}
        placeholder={tc.notesPh}
        onChange={(e) => setCtx({ ...ctx, notes: e.target.value })}
      />

      <div className="flex items-start justify-between gap-4 mt-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{tc.autoAssess}</p>
          <p className="text-[11px] text-muted/60 leading-relaxed mt-0.5">{tc.autoAssessDesc}</p>
        </div>
        <button
          onClick={() => setCtx({ ...ctx, autoAssess: !ctx.autoAssess })}
          className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${ctx.autoAssess ? "bg-accent" : "bg-border"}`}
        >
          <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform ${ctx.autoAssess ? "left-[22px]" : "left-[3px]"}`} />
        </button>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={() => void save()}
          disabled={status === "saving"}
          className="bg-accent hover:bg-accent-hover disabled:opacity-60 transition-colors text-background text-sm font-semibold px-5 py-2 rounded-xl"
        >
          {tc.save}
        </button>
        {status === "saved" && <span className="text-xs text-emerald-400">{tc.saved}</span>}
        {status === "error" && <span className="text-xs text-red-400">{tc.saveFailed}</span>}
      </div>
    </div>
  );
}
