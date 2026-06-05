"use client";

import { useEffect, useState } from "react";
import { Search as SearchIcon, FileText } from "lucide-react";
import { ProjectFilter } from "@/components/project-filter";

interface SearchResult {
  articleId: string;
  title: string;
  snippet: string;
  score: number;
  filePath: string;
  projects?: string[];
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [project, setProject] = useState<string | null>(null);

  // Mirror Ask page: persist the project pick across reloads.
  useEffect(() => {
    const saved = localStorage.getItem("nestbrain-search-project");
    if (saved) setProject(saved);
  }, []);
  useEffect(() => {
    if (project) localStorage.setItem("nestbrain-search-project", project);
    else localStorage.removeItem("nestbrain-search-project");
  }, [project]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (project) params.set("project", project);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <ProjectFilter value={project} onChange={setProject} />
        </div>

        <form onSubmit={handleSearch} className="mb-8">
          <div className="relative">
            <SearchIcon
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={project ? `Search ${project}…` : "Search your knowledge base..."}
              className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
              autoFocus
            />
          </div>
        </form>

        {searching && (
          <p className="text-sm text-muted">Searching...</p>
        )}

        {!searching && searched && results.length === 0 && (
          <p className="text-sm text-muted">No results found.</p>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted mb-4">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </p>
            {results.map((result) => (
              <a
                key={result.articleId}
                href={`/wiki?path=${encodeURIComponent(result.filePath)}`}
                className="block p-4 rounded-xl border border-border bg-card hover:bg-card-hover hover:border-accent/30 transition-all"
              >
                <div className="flex items-start gap-3">
                  <FileText size={16} className="text-accent mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium truncate">{result.title}</h3>
                      {result.projects?.map((p) => (
                        <span
                          key={p}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 shrink-0"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted line-clamp-2">
                      {result.snippet}
                    </p>
                    <p className="text-xs text-muted/50 mt-1">
                      {result.filePath}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
