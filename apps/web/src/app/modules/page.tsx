"use client";

import { useEffect, useState } from "react";
import { Blocks, FolderGit2, Brain } from "lucide-react";
import { useModules } from "@/lib/modules-context";

// Module Settings — one card per ACTIVE module, each hosting its own
// configuration. Modules are Enterprise add-ons: this page only exists in
// the nav when at least one is licensed.

const CATALOG: Record<string, { icon: React.ReactNode; name: string; tagline: string }> = {
  dev: {
    icon: <FolderGit2 size={20} />,
    name: "Dev",
    tagline: "Integrated terminal, Git integration, Projects area, knowledge atoms from commits.",
  },
  anatomize: {
    icon: <Brain size={20} />,
    name: "Anatomize",
    tagline: "Business document intelligence — assessments, friction points, recommendations.",
  },
};

export default function ModulesPage() {
  const { modules, loaded } = useModules();

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <Blocks size={22} className="text-accent" />
        <h1 className="text-xl font-semibold">Modules</h1>
      </div>
      <p className="text-sm text-muted mb-8">
        Enterprise add-ons enabled by your organization&apos;s license. Each module brings its own settings.
      </p>

      {loaded && modules.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted">
          No modules are active on this seat.
        </div>
      )}

      <div className="space-y-5">
        {modules.map((id) => {
          const meta = CATALOG[id] ?? { icon: <Blocks size={20} />, name: id, tagline: "Module" };
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
                      active
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted/70 leading-snug">{meta.tagline}</p>
                </div>
              </div>
              <div className="px-6 py-5">
                {id === "dev" ? <DevModuleSettings /> : (
                  <p className="text-xs text-muted/60">No settings for this module yet.</p>
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
        <p className="text-sm font-medium">Include Projects/ folder in team sync</p>
        <p className="text-[11px] text-muted/60 leading-relaxed mt-0.5">
          Shares your <code className="text-accent/70 bg-accent/5 px-1 rounded">Projects/</code> folder
          through the team&apos;s global workspace — <b className="text-amber-300/90">everyone on the team</b> who
          enables this sees a merged view of each other&apos;s projects. Build artifacts and{" "}
          <code className="text-accent/70 bg-accent/5 px-1 rounded">.git</code> are excluded. Off by default,
          per-device.
          {!connected && (
            <span className="block mt-1 text-amber-300/70">
              Requires an active Team Server connection (Settings → Team Knowledge).
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
