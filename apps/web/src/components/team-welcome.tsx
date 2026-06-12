"use client";

import { useEffect, useRef, useState } from "react";
import { FolderGit2, Brain, Blocks, Sparkles, X } from "lucide-react";

// Celebration popup after a successful Team Server login. Fires only on the
// connecting → connected transition (an explicit login/switch), never on the
// silent session restore at app launch. Localized from the OS language.

type Lang = "en" | "it" | "fr" | "es";

const L: Record<
  Lang,
  { welcome: string; sub: string; modules: string; noModules: string; wish: string; cta: string }
> = {
  en: {
    welcome: "Welcome to",
    sub: "You're connected — your team's knowledge is now flowing to this device.",
    modules: "Modules available on this team",
    noModules: "Knowledge core — no add-on modules on this license.",
    wish: "Have a great session!",
    cta: "Let's get to work →",
  },
  it: {
    welcome: "Benvenuto in",
    sub: "Sei connesso — la conoscenza del tuo team ora fluisce su questo dispositivo.",
    modules: "Moduli disponibili su questo team",
    noModules: "Knowledge core — nessun modulo aggiuntivo su questa licenza.",
    wish: "Buon lavoro!",
    cta: "Al lavoro →",
  },
  fr: {
    welcome: "Bienvenue chez",
    sub: "Vous êtes connecté — le savoir de votre équipe arrive maintenant sur cet appareil.",
    modules: "Modules disponibles pour cette équipe",
    noModules: "Cœur de connaissances — aucun module additionnel sur cette licence.",
    wish: "Bon travail !",
    cta: "Au travail →",
  },
  es: {
    welcome: "Bienvenido a",
    sub: "Estás conectado — el conocimiento de tu equipo ya fluye a este dispositivo.",
    modules: "Módulos disponibles en este equipo",
    noModules: "Núcleo de conocimiento — sin módulos adicionales en esta licencia.",
    wish: "¡Buen trabajo!",
    cta: "Manos a la obra →",
  },
};

function detectLang(): Lang {
  const prefs = typeof navigator !== "undefined"
    ? (navigator.languages?.length ? navigator.languages : [navigator.language])
    : [];
  for (const p of prefs) {
    const c = (p || "").slice(0, 2).toLowerCase();
    if (c === "it" || c === "fr" || c === "es" || c === "en") return c as Lang;
  }
  return "en";
}

const MODULE_META: Record<string, { icon: React.ReactNode; name: string }> = {
  dev: { icon: <FolderGit2 size={15} />, name: "Dev" },
  anatomize: { icon: <Brain size={15} />, name: "Anatomize" },
};

export function TeamWelcome() {
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const prevStatus = useRef<string | undefined>(undefined);
  const t = L[detectLang()];

  useEffect(() => {
    const mn = typeof window !== "undefined" ? window.nestbrain : undefined;
    if (!mn?.team) return;
    void mn.team.getState().then((s) => { prevStatus.current = s?.status; });
    return mn.team.onStateChanged((s) => {
      const prev = prevStatus.current;
      prevStatus.current = s?.status;
      if (prev === "connecting" && s?.status === "connected") {
        setOrg(s.license?.org ?? s.serverUrl ?? "your team");
        // Small delay: the org license (→ module entitlement) is fetched right
        // after connect; give it a beat so the popup shows the real modules.
        setTimeout(() => {
          mn.modules?.get().then(setModules).catch(() => setModules([]));
          setOpen(true);
        }, 600);
      }
    });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="relative w-[min(480px,calc(100vw-32px))] animate-pop-in">
        {/* Glow field behind the card */}
        <div aria-hidden className="absolute -inset-8 rounded-[32px] bg-accent/25 blur-3xl pointer-events-none" />

        <div className="relative rounded-3xl p-[1px] bg-gradient-to-b from-accent/70 via-accent/25 to-transparent">
          <div className="rounded-3xl bg-background border border-border/50 px-8 pt-9 pb-7 text-center overflow-hidden">
            {/* Subtle inner radial glow */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-accent/15 blur-3xl" />

            <button
              onClick={() => setOpen(false)}
              className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-muted/50 hover:text-foreground hover:bg-card transition-colors"
              aria-label="Close"
            >
              <X size={15} />
            </button>

            <div className="relative mx-auto w-14 h-14 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center mb-5">
              <Sparkles size={26} className="text-accent" />
            </div>

            <p className="text-sm text-muted mb-1">{t.welcome}</p>
            <h2 className="text-2xl font-bold tracking-tight mb-3">
              <span className="text-accent">{org}</span>
            </h2>
            <p className="text-[13px] text-muted leading-relaxed max-w-sm mx-auto mb-6">{t.sub}</p>

            {modules.length > 0 ? (
              <div className="mb-7">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/60 mb-3">
                  {t.modules}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {modules.map((id) => {
                    const m = MODULE_META[id] ?? { icon: <Blocks size={15} />, name: id };
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-foreground"
                      >
                        <span className="text-accent">{m.icon}</span>
                        {m.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-[11.5px] text-muted/70 mb-7">{t.noModules}</p>
            )}

            <p className="text-sm font-medium mb-5">{t.wish}</p>

            <button
              onClick={() => setOpen(false)}
              className="w-full bg-accent hover:bg-accent-hover transition-colors text-background font-semibold py-3 rounded-xl text-sm"
            >
              {t.cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
