"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TranslateButton } from "@/components/translate-button";
import { useCompile } from "@/lib/compile-context";
import {
  ChevronRight,
  FileText,
  Folder,
  Trash2,
  ArrowLeft,
  Link2,
  Hash,
} from "lucide-react";

interface WikiNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WikiNode[];
  title?: string;
}

export default function WikiPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          Loading...
        </div>
      }
    >
      <WikiPageContent />
    </Suspense>
  );
}

function WikiPageContent() {
  const searchParams = useSearchParams();
  const articlePath = searchParams.get("path");
  const { status } = useCompile();

  const [tree, setTree] = useState<WikiNode[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [isTranslated, setIsTranslated] = useState(false);
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTree();
  }, []);

  // Refresh tree periodically during compilation and on completion
  useEffect(() => {
    if (status === "success" || status === "error") {
      loadTree();
      return;
    }
    if (status === "compiling") {
      // Refresh tree every 5s during compilation to show new articles appearing
      const interval = setInterval(loadTree, 5000);
      return () => clearInterval(interval);
    }
  }, [status]);

  useEffect(() => {
    if (articlePath) {
      loadArticle(articlePath);
    } else {
      setContent(null);
      setMeta(null);
    }
  }, [articlePath]);

  async function loadTree() {
    setLoading(true);
    try {
      const res = await fetch("/api/wiki");
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch {
      setTree([]);
    }
    setLoading(false);
  }

  async function loadArticle(path: string) {
    setIsTranslated(false);
    try {
      const res = await fetch(`/api/wiki?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setContent(data.content ?? null);
      setOriginalContent(data.content ?? null);

      // Parse frontmatter for metadata display
      if (data.content) {
        const fmMatch = data.content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const parsed: Record<string, string> = {};
          for (const line of fmMatch[1].split("\n")) {
            const m = line.match(/^(\w+):\s*(.+)$/);
            if (m) parsed[m[1]] = m[2].replace(/^"|"$/g, "");
          }
          setMeta(parsed);
        }
      }
    } catch {
      setContent(null);
      setMeta(null);
    }
  }

  // Count total articles
  function countArticles(nodes: WikiNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === "file") count++;
      if (node.children) count += countArticles(node.children);
    }
    return count;
  }

  const totalArticles = countArticles(tree);

  // Extract backlinks and wikilinks from current content
  const backlinks: string[] = [];
  const outlinks: string[] = [];
  if (content) {
    const blMatch = content.match(/backlinks:\s*\[([^\]]*)\]/);
    if (blMatch) {
      backlinks.push(
        ...blMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/["\[\]]/g, ""))
          .filter(Boolean)
      );
    }
    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m;
    const body = content.replace(/^---[\s\S]*?---/, "");
    while ((m = linkRegex.exec(body)) !== null) {
      const link = m[1].trim();
      if (!outlinks.includes(link)) outlinks.push(link);
    }
  }

  return (
    <div className="flex-1 flex">
      {/* Wiki sidebar tree */}
      <div className="w-60 border-r border-border flex flex-col shrink-0 bg-[#0c0c0e]">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-medium text-muted/70 uppercase tracking-widest">
            Articles
          </h2>
          <p className="text-[11px] text-muted/40 mt-1">
            {totalArticles} pages
          </p>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <p className="text-xs text-muted/40 p-2">Loading...</p>
          ) : tree.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-xs text-muted/50 leading-relaxed">
                No articles yet.
                <br />
                Ingest sources and compile.
              </p>
            </div>
          ) : (
            <TreeView nodes={tree} activePath={articlePath} />
          )}
        </div>
      </div>

      {/* Article content area */}
      <div className="flex-1 flex">
        <div className="flex-1 overflow-auto">
          {content && articlePath ? (
            <div className="max-w-[720px] mx-auto py-10 px-8">
              {/* Breadcrumb + Translate */}
              <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-1.5 text-[11px] text-muted/50">
                <a
                  href="/wiki"
                  className="hover:text-muted transition-colors"
                >
                  Wiki
                </a>
                {articlePath.split("/").map((part, i, arr) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <ChevronRight size={10} />
                    <span
                      className={
                        i === arr.length - 1
                          ? "text-muted"
                          : "hover:text-muted transition-colors"
                      }
                    >
                      {part.replace(".md", "").replace(/-/g, " ")}
                    </span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <TranslateButton
                  content={content}
                  onTranslated={(translated) => {
                    setContent(translated);
                    setIsTranslated(true);
                  }}
                  onReset={() => {
                    setContent(originalContent);
                    setIsTranslated(false);
                  }}
                  isTranslated={isTranslated}
                />
                {articlePath.startsWith("outputs/") && (
                  <button
                    onClick={async () => {
                      if (!confirm("Delete this output?")) return;
                      await fetch("/api/wiki/delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: articlePath }),
                      });
                      window.location.href = "/wiki";
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                )}
              </div>
              </div>

              <MarkdownRenderer content={content} meta={meta ?? undefined} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mx-auto mb-5">
                  <FileText size={24} className="text-muted/30" />
                </div>
                <p className="text-sm text-muted/60 mb-1">
                  Select an article
                </p>
                <p className="text-xs text-muted/30">
                  Browse the tree or use search
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: backlinks & outlinks */}
        {content && (outlinks.length > 0 || backlinks.length > 0) && (
          <div className="w-56 border-l border-border/50 p-4 overflow-auto shrink-0 bg-[#0c0c0e]">
            {outlinks.length > 0 && (
              <div className="mb-6">
                <h3 className="text-[10px] font-medium text-muted/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Link2 size={10} />
                  Links to
                </h3>
                <div className="space-y-1">
                  {outlinks.map((link) => (
                    <WikiLinkButton key={link} name={link} />
                  ))}
                </div>
              </div>
            )}

            {backlinks.length > 0 && (
              <div>
                <h3 className="text-[10px] font-medium text-muted/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <ArrowLeft size={10} />
                  Linked from
                </h3>
                <div className="space-y-1">
                  {backlinks.map((link) => (
                    <WikiLinkButton key={link} name={link} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WikiLinkButton({ name }: { name: string }) {
  const displayName = name
    .replace(/.*\//, "")
    .replace(/-/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <a
      href="#"
      onClick={async (e) => {
        e.preventDefault();
        const res = await fetch(
          `/api/wiki/resolve?name=${encodeURIComponent(name)}`
        );
        const data = await res.json();
        if (data.path) {
          window.location.href = `/wiki?path=${encodeURIComponent(data.path)}`;
        }
      }}
      className="block px-2.5 py-1.5 rounded-lg text-[12px] text-muted hover:text-accent hover:bg-accent/5 transition-all truncate"
    >
      {displayName}
    </a>
  );
}

function TreeView({
  nodes,
  activePath,
}: {
  nodes: WikiNode[];
  activePath: string | null;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} activePath={activePath} />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  activePath,
}: {
  node: WikiNode;
  activePath: string | null;
}) {
  const [open, setOpen] = useState(true);
  const isActive = activePath === node.path;

  if (node.type === "directory") {
    const hasActiveChild = activePath?.startsWith(node.name + "/");
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${
            hasActiveChild
              ? "text-foreground/80"
              : "text-muted/60 hover:text-foreground/80 hover:bg-card/50"
          }`}
        >
          <ChevronRight
            size={11}
            className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
          <Folder size={11} className="text-accent/40" />
          <span className="capitalize font-medium">{node.name}</span>
          {node.children && (
            <span className="ml-auto text-[10px] text-muted/30">
              {node.children.length}
            </span>
          )}
        </button>
        {open && node.children && (
          <div className="ml-3 mt-0.5 pl-2 border-l border-border/20">
            <TreeView nodes={node.children} activePath={activePath} />
          </div>
        )}
      </div>
    );
  }

  return (
    <a
      href={`/wiki?path=${encodeURIComponent(node.path)}`}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-all ${
        isActive
          ? "bg-accent/10 text-accent font-medium"
          : "text-muted/60 hover:text-foreground/80 hover:bg-card/50"
      }`}
    >
      <Hash size={10} className={isActive ? "text-accent/60" : "text-muted/30"} />
      <span className="truncate">{node.title ?? node.name.replace(".md", "")}</span>
    </a>
  );
}
