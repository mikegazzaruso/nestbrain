"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "@/lib/terminal-context";
import { IntegratedTerminal } from "./integrated-terminal";
import { X, Terminal as TerminalIcon, ChevronDown } from "lucide-react";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;
const STORAGE_KEY = "nestbrain-terminal-height";

export function TerminalPanel() {
  const { sessions, activeId, panelOpen, setActive, closeTerminal, togglePanel } =
    useTerminal();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parseInt(saved))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const startY = e.clientY;
    const startH = height;

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = startY - ev.clientY;
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + delta));
      setHeight(next);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      localStorage.setItem(STORAGE_KEY, String(height));
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [height]);

  // Don't unmount when hidden — keep xterm alive to preserve scrollback + prompt.
  // The panel just collapses to 0 height via CSS.
  const isVisible = panelOpen && sessions.length > 0;
  if (sessions.length === 0) return null;

  return (
    <div
      className="border-t border-border bg-background flex flex-col shrink-0"
      style={{ height: isVisible ? height : 0, overflow: "hidden" }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors shrink-0"
      />

      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-card/40 shrink-0">
        <div className="flex items-center flex-1 overflow-x-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 border-r border-border cursor-pointer text-[11px] transition-colors ${
                activeId === s.id
                  ? "bg-background text-foreground"
                  : "text-muted hover:text-foreground hover:bg-card"
              }`}
            >
              <TerminalIcon size={12} className="text-accent/70 shrink-0" />
              <span className="truncate max-w-[160px]">{s.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted/50 hover:text-foreground transition-opacity"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={togglePanel}
          className="p-2 text-muted/50 hover:text-foreground transition-colors"
          title="Hide terminal"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Terminal surfaces */}
      <div className="flex-1 relative overflow-hidden">
        {sessions.map((s) => (
          <IntegratedTerminal
            key={s.id}
            sessionId={s.id}
            active={activeId === s.id}
            visible={isVisible}
          />
        ))}
      </div>
    </div>
  );
}
