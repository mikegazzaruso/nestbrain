"use client";

import { useState, useRef, useEffect } from "react";
import { Languages, Loader2, X } from "lucide-react";

const LANGUAGES = [
  { code: "Italian", label: "Italiano" },
  { code: "Spanish", label: "Espanol" },
  { code: "French", label: "Francais" },
  { code: "German", label: "Deutsch" },
  { code: "Portuguese", label: "Portugues" },
  { code: "Chinese", label: "Chinese" },
  { code: "Japanese", label: "Japanese" },
  { code: "Korean", label: "Korean" },
  { code: "Russian", label: "Russian" },
  { code: "Arabic", label: "Arabic" },
  { code: "Hindi", label: "Hindi" },
  { code: "English", label: "English" },
];

interface TranslateButtonProps {
  content: string;
  onTranslated: (translated: string) => void;
  onReset: () => void;
  isTranslated: boolean;
}

export function TranslateButton({ content, onTranslated, onReset, isTranslated }: TranslateButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeLang, setActiveLang] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function translate(language: string) {
    setOpen(false);
    setLoading(true);
    setActiveLang(language);
    try {
      const res = await fetch("/api/wiki/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, language }),
      });
      const data = await res.json();
      if (data.translated) {
        onTranslated(data.translated);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  if (isTranslated) {
    return (
      <button
        onClick={() => { onReset(); setActiveLang(null); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
      >
        <X size={12} />
        Show original
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:text-foreground hover:bg-card transition-colors disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Translating to {activeLang}...
          </>
        ) : (
          <>
            <Languages size={12} />
            Translate
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-44 py-1 bg-card border border-border rounded-xl shadow-2xl z-50 max-h-64 overflow-auto">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => translate(lang.code)}
              className="w-full text-left px-3 py-2 text-xs text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
