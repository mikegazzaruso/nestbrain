"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Search,
  MessageCircle,
  Download,
  Network,
  Activity,
  Lightbulb,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { CompileIndicator } from "./compile-indicator";
import { FileTree } from "./file-tree";
import { NewProjectModal } from "./new-project-modal";
import { BranchIndicator } from "./branch-indicator";
import { useTheme } from "@/lib/theme-context";
import { useTerminal } from "@/lib/terminal-context";

const navItems = [
  { href: "/wiki", icon: BookOpen, label: "Wiki" },
  { href: "/mindmap", icon: Network, label: "Mind Map" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/ask", icon: MessageCircle, label: "Ask" },
  { href: "/ingest", icon: Download, label: "Ingest" },
  { href: "/knowledge", icon: Lightbulb, label: "Knowledge" },
  { href: "/health", icon: Activity, label: "Health" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "nestbrain-sidebar-width";

export function Sidebar() {
  const pathname = usePathname();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const [nestBrainPath, setNestBrainPath] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { openTerminal } = useTerminal();

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved))));
  }, []);

  // Load NestBrain path (Electron only). Subscribes to onNestBrainMoved
  // so the file tree appears as soon as onboarding completes (and updates
  // when the user moves the workspace from Settings).
  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain) return;
    function refetch() {
      window.nestbrain!
        .getBootstrap()
        .then((b) => {
          if (b.nestBrainPath) setNestBrainPath(b.nestBrainPath);
        })
        .catch(() => { /* ignore */ });
    }
    refetch();
    const off = window.nestbrain.onNestBrainMoved?.(() => refetch());
    return off;
  }, []);

  const handleCreateProject = useCallback(
    async (projectName: string) => {
      if (!nestBrainPath || typeof window === "undefined" || !window.nestbrain) {
        throw new Error("NestBrain path not available");
      }
      const projectPath = `${nestBrainPath}/Projects/${projectName}`;
      await window.nestbrain.fs.createDir(projectPath);
      await openTerminal(projectPath, projectName);
      // Trigger file tree refresh via focus event
      window.dispatchEvent(new Event("focus"));
    },
    [nestBrainPath, openTerminal],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    // Coalesce mousemove → one setState per animation frame instead of one
    // per pixel. Without this, fast drags fire 10–20 setState/frame and the
    // sidebar (which feeds three contexts and re-renders the file tree) can
    // visibly judder mid-drag. The pendingWidth ref also persists the last
    // value we computed so the rAF callback always picks up the freshest.
    let pendingWidth = width;
    let rafId: number | null = null;

    function flush() {
      rafId = null;
      setWidth(pendingWidth);
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      pendingWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      if (rafId === null) rafId = requestAnimationFrame(flush);
    }

    function onMouseUp() {
      isDragging.current = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Persist the final width once on mouse-up — saving on every frame
      // wastes a localStorage write per pixel of drag.
      localStorage.setItem(STORAGE_KEY, String(pendingWidth));
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  const { theme, toggle } = useTheme();

  // Poll knowledge counts so the sidebar shows two badges:
  // - blue (accent): atoms awaiting review
  // - green: accepted atoms waiting for the next compile
  // Both hide when zero. The endpoint reads two small dirs + a JSON file, so
  // a 10s cadence is cheap.
  const [pendingCount, setPendingCount] = useState(0);
  const [acceptedUncompiled, setAcceptedUncompiled] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const res = await fetch("/api/knowledge/counts", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setPendingCount(data.pending ?? 0);
        setAcceptedUncompiled(data.acceptedUncompiled ?? 0);
      } catch {
        /* ignore — endpoint may not be wired yet */
      }
    };
    void fetchCounts();
    // Long cadence: a 10s poll caused a visible flash whenever the badge
    // re-rendered into existence. The /knowledge page already refreshes
    // its own list when it's mounted; the sidebar badge is just an
    // ambient notification.
    const id = setInterval(fetchCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="relative shrink-0 flex" style={{ width }}>
      <aside className="w-full h-full border-r border-sidebar-border bg-sidebar flex flex-col overflow-hidden">
        {/* Logo — the wrapper is the macOS window-drag region (leaves room for
            the traffic lights); the inner Link opts back into no-drag (see
            globals.css) so clicking it actually navigates Home. */}
        <div className="sidebar-header border-b border-sidebar-border">
          <Link
            href="/"
            title="Home"
            className="block px-5 py-4 hover:bg-card/40 transition-colors cursor-pointer"
          >
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                <span className="text-accent">Nest</span>Brain
              </h1>
              <span className="text-[10px] text-muted/40 italic">by NextEpochs</span>
            </div>
            <p className="text-[11px] text-muted/60 mt-0.5">v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
          </Link>
        </div>

        {/* NestBrain file tree (Electron only, after onboarding) */}
        {nestBrainPath && (
          <FileTree
            rootPath={nestBrainPath}
            onNewProject={() => setNewProjectOpen(true)}
          />
        )}

        {/* Compile indicator */}
        <CompileIndicator />

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-auto">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            const isKnowledge = item.href === "/knowledge";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-card-hover text-foreground"
                    : "text-muted hover:text-foreground hover:bg-card"
                }`}
              >
                <Icon size={16} />
                <span className="flex-1">{item.label}</span>
                {isKnowledge && pendingCount > 0 && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/15 text-accent"
                    title={`${pendingCount} atom${pendingCount === 1 ? "" : "s"} awaiting review`}
                  >
                    {pendingCount}
                  </span>
                )}
                {isKnowledge && acceptedUncompiled > 0 && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300"
                    title={`${acceptedUncompiled} accepted atom${acceptedUncompiled === 1 ? "" : "s"} waiting for next compile`}
                  >
                    {acceptedUncompiled}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer — the BranchIndicator slot is height-reserved so the
            footer doesn't bob whenever the chip appears or disappears */}
        <div className="h-9 px-4 border-t border-sidebar-border flex items-center gap-2">
          <p className="text-[10px] text-muted/30 shrink-0">NestBrain</p>
          <div className="flex-1 min-w-0 flex justify-center">
            <BranchIndicator />
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-accent/20 active:bg-accent/30 transition-colors"
      />

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-md text-muted/40 hover:text-muted hover:bg-card transition-colors"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  );
}
