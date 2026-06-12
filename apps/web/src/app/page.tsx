"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Search,
  MessageCircle,
  Download,
  Network,
  FileText,
  Brain,
  BarChart3,
  Library,
} from "lucide-react";
import { useT } from "@/lib/app-i18n";

interface Stats {
  sources: number;
  concepts: number;
  outputs: number;
  rawFiles: number;
  totalWords: number;
  recentArticles: Array<{ title: string; path: string; updated: string; type: string }>;
}

const TYPE_COLORS: Record<string, string> = {
  "source-summary": "bg-purple-500/10 text-purple-400",
  concept: "bg-accent/10 text-accent",
  "qa-output": "bg-green-500/10 text-green-400",
  sources: "bg-purple-500/10 text-purple-400",
  concepts: "bg-accent/10 text-accent",
  outputs: "bg-green-500/10 text-green-400",
};

export default function Home() {
  const { t } = useT();
  const h = t.wiki.home;
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/wiki/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const hasData = stats && (stats.sources > 0 || stats.concepts > 0);

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="text-accent">Nest</span>Brain
          </h1>
          <p className="text-muted text-sm">{h.tagline}</p>
        </div>

        {/* Stats cards */}
        {hasData && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-10">
            {[
              // Articles = the actual knowledge you hold (incl. anything pulled
              // from a team workspace). Sources counts locally-ingested raw docs,
              // which is legitimately 0 on a device that only receives team sync.
              { label: h.stats.articles, value: stats.sources + stats.concepts + stats.outputs, icon: Library },
              { label: h.stats.sources, value: stats.rawFiles, icon: Download },
              { label: h.stats.summaries, value: stats.sources, icon: FileText },
              { label: h.stats.concepts, value: stats.concepts, icon: Brain },
              { label: h.stats.outputs, value: stats.outputs, icon: BarChart3 },
              { label: h.stats.words, value: stats.totalWords.toLocaleString(), icon: BookOpen },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="p-4 rounded-xl bg-card border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={14} className="text-muted/50" />
                    <p className="text-[10px] text-muted/50 uppercase tracking-wider">{s.label}</p>
                  </div>
                  <p className="text-xl font-semibold">{s.value}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3 mb-10">
          {[
            { href: "/ingest", icon: Download, title: h.actions.ingestTitle, desc: h.actions.ingestDesc },
            { href: "/wiki", icon: BookOpen, title: h.actions.wikiTitle, desc: h.actions.wikiDesc },
            { href: "/search", icon: Search, title: h.actions.searchTitle, desc: h.actions.searchDesc },
            { href: "/ask", icon: MessageCircle, title: h.actions.askTitle, desc: h.actions.askDesc },
            { href: "/mindmap", icon: Network, title: h.actions.mindmapTitle, desc: h.actions.mindmapDesc },
            { href: "/health", icon: BarChart3, title: h.actions.healthTitle, desc: h.actions.healthDesc },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group p-5 rounded-xl border border-border bg-card hover:bg-card-hover hover:border-accent/30 transition-all"
              >
                <Icon size={18} className="text-accent mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-muted/60">{item.desc}</p>
              </Link>
            );
          })}
        </div>

        {/* Recent articles */}
        {stats && stats.recentArticles.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-muted/70 uppercase tracking-wider mb-4">
              {h.recentArticles}
            </h2>
            <div className="space-y-1">
              {stats.recentArticles.map((article) => (
                <a
                  key={article.path}
                  href={`/wiki?path=${encodeURIComponent(article.path)}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-card transition-colors"
                >
                  <FileText size={14} className="text-muted/40 shrink-0" />
                  <span className="text-sm flex-1 truncate">{article.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_COLORS[article.type] ?? "bg-card text-muted"}`}>
                    {article.type}
                  </span>
                  <span className="text-[10px] text-muted/30">{article.updated}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasData && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🧠</div>
            <h2 className="text-xl font-semibold tracking-tight mb-2">
              {h.emptyTitleA}<span className="text-accent">{h.emptyTitleB}</span>
            </h2>
            <p className="text-muted text-sm mb-6">
              {h.emptyDesc}
            </p>
            <Link
              href="/ingest"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
            >
              <Download size={16} />
              {h.getStarted}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
