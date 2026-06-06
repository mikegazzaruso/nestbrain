"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface IntegratedTerminalProps {
  sessionId: string;
  active: boolean;
  visible: boolean;
}

export function IntegratedTerminal({
  sessionId,
  active,
  visible,
}: IntegratedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined" || !window.nestbrain) {
      return;
    }

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#e8e8e8",
        cursor: "#6c9cfc",
        selectionBackground: "#6c9cfc50",
        black: "#1e1e1e",
        red: "#f48771",
        green: "#4ec9b0",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4fc1ff",
        white: "#d4d4d4",
        brightBlack: "#666666",
        brightRed: "#f48771",
        brightGreen: "#4ec9b0",
        brightYellow: "#dcdcaa",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#4fc1ff",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Fit to container
    try {
      fit.fit();
    } catch { /* ignore */ }

    const mn = window.nestbrain!;

    const offData = mn.terminal.onData(sessionId, (data) => {
      term.write(data);
    });
    const offExit = mn.terminal.onExit(sessionId, (code) => {
      term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    const dataDisp = term.onData((data) => {
      mn.terminal.write(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
        mn.terminal.resize(sessionId, termRef.current.cols, termRef.current.rows);
      } catch { /* ignore */ }
    });
    resizeObserver.observe(containerRef.current);

    // Initial resize sync
    setTimeout(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
        mn.terminal.resize(sessionId, termRef.current.cols, termRef.current.rows);
      } catch { /* ignore */ }
    }, 50);

    return () => {
      offData();
      offExit();
      dataDisp.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  // Refit when becoming active or panel becomes visible again
  useEffect(() => {
    if (active && visible && fitRef.current && termRef.current && typeof window !== "undefined" && window.nestbrain) {
      // Small delay so the container has its final size
      const t = setTimeout(() => {
        try {
          fitRef.current?.fit();
          if (termRef.current) {
            window.nestbrain!.terminal.resize(
              sessionId,
              termRef.current.cols,
              termRef.current.rows,
            );
            termRef.current.refresh(0, termRef.current.rows - 1);
            termRef.current.focus();
          }
        } catch { /* ignore */ }
      }, 30);
      return () => clearTimeout(t);
    }
  }, [active, visible, sessionId]);

  // Drag-and-drop a file (or several) onto the terminal: inject the absolute
  // path(s) into the PTY input stream, single-quoted when the path contains
  // shell-significant characters. Mirrors the Xcode / iTerm gesture.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (typeof window === "undefined" || !window.nestbrain) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const paths: string[] = [];
    for (const f of files) {
      try {
        const p = window.nestbrain.getPathForFile(f);
        if (p) paths.push(quoteShellPath(p));
      } catch {
        /* ignore — file may have come from outside the sandbox */
      }
    }
    if (paths.length === 0) return;
    // Leading space so the path doesn't get concatenated onto whatever the
    // user already typed without separation.
    const text = (paths.length === 1 ? "" : "") + paths.join(" ") + " ";
    window.nestbrain.terminal.write(sessionId, text);
    termRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      onDrop={handleDrop}
      onDragOver={(e) => {
        // Required to let the drop event fire; the default would block it.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      className={`absolute inset-0 ${active ? "block" : "hidden"}`}
      style={{ padding: "8px 0 0 8px" }}
    />
  );
}

/**
 * Single-quote a path for POSIX-y shells when it contains any character
 * that would otherwise need escaping. Embedded single quotes are handled
 * via the `'\''` close-quote/escape/open-quote idiom that works in sh,
 * bash, zsh, and fish.
 */
function quoteShellPath(p: string): string {
  if (/^[A-Za-z0-9_./\-+@%]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
