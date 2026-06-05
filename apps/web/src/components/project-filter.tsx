"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";

interface ProjectEntry {
  project: string;
  count: number;
}

interface ProjectFilterProps {
  value: string | null;
  onChange: (project: string | null) => void;
  className?: string;
}

/**
 * Compact dropdown for scoping search / ask to a single project. Sources its
 * options from /api/projects/list (vector-index project counts). Hides
 * itself entirely when the knowledge base has no project-tagged entries —
 * showing an "All projects" dropdown with only one option is just chrome.
 */
export function ProjectFilter({ value, onChange, className = "" }: ProjectFilterProps) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/projects/list", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setProjects(data.projects ?? []);
      } catch {
        /* ignore */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded || projects.length === 0) return null;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Layers size={13} className="text-muted/60" />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="bg-card border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent/50"
        title="Scope retrieval to one project"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.project} value={p.project}>
            {p.project} ({p.count})
          </option>
        ))}
      </select>
    </div>
  );
}
