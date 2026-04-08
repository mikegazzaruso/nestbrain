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
  Settings,
} from "lucide-react";
import { CompileIndicator } from "./compile-indicator";

const navItems = [
  { href: "/wiki", icon: BookOpen, label: "Wiki" },
  { href: "/mindmap", icon: Network, label: "Mind Map" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/ask", icon: MessageCircle, label: "Ask" },
  { href: "/ingest", icon: Download, label: "Ingest" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "mindnest-sidebar-width";

export function Sidebar() {
  const pathname = usePathname();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved))));
  }, []);

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

  return (
    <div className="relative shrink-0 flex" style={{ width }}>
      <aside className="w-full h-screen sticky top-0 border-r border-sidebar-border bg-sidebar flex flex-col overflow-hidden">
        {/* Logo */}
        <Link href="/" className="block px-5 py-4 border-b border-sidebar-border">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-accent">Mind</span>Nest
          </h1>
          <p className="text-[11px] text-muted/50 mt-0.5">Knowledge Base</p>
        </Link>

        {/* Compile indicator — right under logo */}
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
        <div className="px-5 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-muted/30">v0.1.0 — MVP</p>
        </div>
      </aside>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-accent/20 active:bg-accent/30 transition-colors"
      />
    </div>
  );
}
