"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  AlertCircle,
  Info,
  FileText,
  Loader2,
  Lightbulb,
  Link2Off,
  FileQuestion,
} from "lucide-react";

interface LintFinding {
  severity: "info" | "warning" | "error";
  category: string;
  message: string;
  filePath?: string;
}

interface LintReport {
  findings: LintFinding[];
  stats: {
    totalArticles: number;
    orphans: number;
    missingBacklinks: number;
    suggestedArticles: number;
  };
  generatedAt: string;
}

const SEVERITY_CONFIG = {
  error: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  info: { icon: Info, color: "text-accent", bg: "bg-accent/10 border-accent/20" },
};

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  orphan: Link2Off,
  "missing-data": FileQuestion,
  gap: Lightbulb,
  inconsistency: AlertTriangle,
};

export default function HealthPage() {
  const [report, setReport] = useState<LintReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function runLint() {
    setLoading(true);
    try {
      const res = await fetch("/api/lint", { method: "POST" });
      const data = await res.json();
      if (!data.error) setReport(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-muted" />
            <h1 className="text-2xl font-semibold tracking-tight">Wiki Health</h1>
          </div>
          <button
            onClick={runLint}
            disabled={loading}
            className="px-4 py-2 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            {loading ? "Analyzing..." : "Run Health Check"}
          </button>
        </div>

        {!report && !loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center text-muted">
              <Activity size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm">Run a health check to analyze your wiki</p>
            </div>
          </div>
        )}

        {report && (
          <div className="space-y-8">
            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Articles", value: report.stats.totalArticles, color: "text-foreground" },
                { label: "Orphans", value: report.stats.orphans, color: report.stats.orphans > 0 ? "text-amber-400" : "text-green-400" },
                { label: "Broken Links", value: report.stats.missingBacklinks, color: report.stats.missingBacklinks > 0 ? "text-amber-400" : "text-green-400" },
                { label: "Suggested", value: report.stats.suggestedArticles, color: report.stats.suggestedArticles > 0 ? "text-accent" : "text-muted" },
              ].map((stat) => (
                <div key={stat.label} className="p-4 rounded-xl bg-card border border-border">
                  <p className="text-[11px] text-muted/60 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className={`text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Health score */}
            <div className="p-5 rounded-xl bg-card border border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">Health Score</p>
                <p className={`text-lg font-bold ${
                  report.findings.length === 0 ? "text-green-400" :
                  report.findings.some((f) => f.severity === "error") ? "text-red-400" :
                  report.findings.some((f) => f.severity === "warning") ? "text-amber-400" :
                  "text-green-400"
                }`}>
                  {report.findings.length === 0
                    ? "Excellent"
                    : report.findings.filter((f) => f.severity === "error").length > 0
                      ? "Needs Attention"
                      : report.findings.filter((f) => f.severity === "warning").length > 0
                        ? "Good"
                        : "Great"}
                </p>
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    report.findings.length === 0 ? "bg-green-500 w-full" :
                    report.findings.some((f) => f.severity === "error") ? "bg-red-500 w-1/4" :
                    report.findings.some((f) => f.severity === "warning") ? "bg-amber-500 w-2/3" :
                    "bg-green-500 w-5/6"
                  }`}
                />
              </div>
            </div>

            {/* Findings */}
            {report.findings.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-muted/70 uppercase tracking-wider mb-4">
                  Findings ({report.findings.length})
                </h2>
                <div className="space-y-2">
                  {report.findings.map((finding, i) => {
                    const sev = SEVERITY_CONFIG[finding.severity];
                    const SevIcon = sev.icon;
                    const CatIcon = CATEGORY_ICONS[finding.category] ?? FileText;
                    return (
                      <div
                        key={i}
                        className={`p-4 rounded-xl border ${sev.bg} flex items-start gap-3`}
                      >
                        <SevIcon size={16} className={`${sev.color} mt-0.5 shrink-0`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{finding.message}</p>
                          {finding.filePath && (
                            <a
                              href={`/wiki?path=${encodeURIComponent(finding.filePath)}`}
                              className="text-[11px] text-accent/60 hover:text-accent mt-1 inline-block"
                            >
                              {finding.filePath}
                            </a>
                          )}
                        </div>
                        <CatIcon size={12} className="text-muted/30 shrink-0 mt-1" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {report.findings.length === 0 && (
              <div className="p-8 rounded-xl bg-green-500/5 border border-green-500/20 text-center">
                <p className="text-green-400 font-medium">Your wiki is healthy!</p>
                <p className="text-xs text-muted/50 mt-1">No issues found.</p>
              </div>
            )}

            <p className="text-[10px] text-muted/30">
              Report generated {new Date(report.generatedAt).toLocaleString()} · Saved to wiki/outputs/health-report.md
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
