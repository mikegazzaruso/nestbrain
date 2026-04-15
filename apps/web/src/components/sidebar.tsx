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
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { CompileIndicator } from "./compile-indicator";
import { FileTree } from "./file-tree";
import { NewProjectModal } from "./new-project-modal";
import { useTheme } from "@/lib/theme-context";
import { useTerminal } from "@/lib/terminal-context";

const navItems = [
  { href: "/wiki", icon: BookOpen, label: "Wiki" },
  { href: "/mindmap", icon: Network, label: "Mind Map" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/ask", icon: MessageCircle, label: "Ask" },
  { href: "/ingest", icon: Download, label: "Ingest" },
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

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Save
      localStorage.setItem(STORAGE_KEY, String(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))));
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  // Save on width change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const { theme, toggle } = useTheme();

  return (
    <div className="relative shrink-0 flex" style={{ width }}>
      <aside className="w-full h-full border-r border-sidebar-border bg-sidebar flex flex-col overflow-hidden">
        {/* Logo */}
        <Link href="/" className="sidebar-header block px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              <span className="text-accent">Nest</span>Brain
            </h1>
            <span className="text-[10px] text-muted/40 italic">by NextEpochs</span>
          </div>
          <p className="text-[11px] text-muted/60 mt-0.5">v0.11.1</p>
        </Link>

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
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-sidebar-border flex items-center justify-between">
          <p className="text-[10px] text-muted/30">NestBrain</p>
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
