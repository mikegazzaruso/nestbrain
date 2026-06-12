"use client";

import { Languages, Check } from "lucide-react";
import { APP_LANGS, useT } from "@/lib/app-i18n";

// Settings → Language. Explicit choice wins and persists; "Auto" follows the
// OS language (the default until the user picks one).

export function LanguageSection() {
  const { lang, setLang, explicit, clearLang, t } = useT();

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Languages size={16} className="text-accent" />
        <h2 className="text-sm font-semibold">{t.common.language.title}</h2>
      </div>
      <p className="text-xs text-muted mb-4">{t.common.language.subtitle}</p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          onClick={clearLang}
          className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
            !explicit
              ? "border-accent/60 bg-accent/10 text-foreground"
              : "border-border bg-background hover:border-accent/30 text-muted hover:text-foreground"
          }`}
        >
          <span className="text-base leading-none">🌐</span>
          {t.common.language.auto}
          {!explicit && <Check size={11} className="text-accent" />}
        </button>
        {APP_LANGS.map((l) => {
          const active = explicit && lang === l.code;
          return (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
                active
                  ? "border-accent/60 bg-accent/10 text-foreground"
                  : "border-border bg-background hover:border-accent/30 text-muted hover:text-foreground"
              }`}
            >
              <span className="text-base leading-none">{l.flag}</span>
              {l.name}
              {active && <Check size={11} className="text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
