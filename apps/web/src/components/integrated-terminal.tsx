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
  // Last (cols, rows) we successfully shipped to the PTY. Used to avoid
  // re-sending identical resizes during the React render storm that
  // accompanies show/hide transitions — every redundant resize causes the
  // shell (and any TUI like `claude` or `htop`) to redraw, and a redraw at
  // the wrong moment is what produces the "text overlapping" glitch.
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined" || !window.nestbrain) {
      return;
    }

    const container = containerRef.current;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      // letterSpacing 0 is critical — non-zero values throw off xterm's
      // monospace cell calculations and produce the kind of "characters
      // creeping over each other" effect Claude Code's TUI shows.
      letterSpacing: 0,
      cursorBlink: true,
      // `allowProposedApi` enables the addon-fit dimension calculations.
      // Already on in defaults but pinning it explicitly avoids regressions
      // on xterm version bumps.
      allowProposedApi: true,
      // Default xterm "scroll on output" is true; turn off the noisy keep-
      // up-to-bottom for interactive TUI redraws so their cursor moves
      // don't fight with auto-scroll.
      scrollOnUserInput: true,
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
    term.open(container);

    termRef.current = term;
    fitRef.current = fit;

    const mn = window.nestbrain!;

    /**
     * Run fit() + ship the resulting size to the PTY, but only when the
     * container is actually laid out. Hidden containers (display:none) have
     * 0×0 dimensions, in which case fit() collapses to xterm's 2×2 minimum
     * and any output drawn in that state lands in a tiny corner — that's
     * the root cause of the overlap glitch when you toggle the terminal
     * panel off/on while a TUI is running.
     */
    function safeFit(reason: string) {
      void reason; // useful for ad-hoc debugging
      const c = containerRef.current;
      if (!c || !fitRef.current || !termRef.current) return;
      const rect = c.getBoundingClientRect();
      // Need at least a cell's worth of space in both axes before we trust
      // fit. Below that we're either hidden or mid-transition.
      if (rect.width < 24 || rect.height < 18) return;
      try {
        fitRef.current.fit();
      } catch {
        return;
      }
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) {
        return;
      }
      const prev = lastSizeRef.current;
      if (prev && prev.cols === cols && prev.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      try {
        mn.terminal.resize(sessionId, cols, rows);
      } catch {
        /* PTY may have exited */
      }
    }

    /** Coalesce many ResizeObserver / mount fires into a single fit. */
    function scheduleFit(delay = 50) {
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        fitTimerRef.current = null;
        safeFit("scheduled");
      }, delay);
    }

    const offData = mn.terminal.onData(sessionId, (data) => {
      term.write(data);
    });
    const offExit = mn.terminal.onExit(sessionId, (code) => {
      term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    const dataDisp = term.onData((data) => {
      mn.terminal.write(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => scheduleFit(50));
    resizeObserver.observe(container);

    // Initial fit once the layout has settled.
    scheduleFit(60);

    return () => {
      if (fitTimerRef.current) {
        clearTimeout(fitTimerRef.current);
        fitTimerRef.current = null;
      }
      offData();
      offExit();
      dataDisp.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      lastSizeRef.current = null;
    };
  }, [sessionId]);

  // When this session becomes the active+visible one again (tab switch, or
  // panel re-opened), re-fit and force a full repaint so a TUI that was
  // mid-redraw at the time we hid the panel comes back drawn at the right
  // dimensions instead of with stale glyphs from a smaller grid.
  useEffect(() => {
    if (!active || !visible) return;
    if (!fitRef.current || !termRef.current) return;
    if (typeof window === "undefined" || !window.nestbrain) return;
    // Two-phase settle: first frame catches the show transition, the second
    // (longer) one catches any layout adjustments from the surrounding
    // resizable panel.
    const t1 = setTimeout(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 18) return;
      try {
        fit.fit();
        const { cols, rows } = term;
        const prev = lastSizeRef.current;
        if (!prev || prev.cols !== cols || prev.rows !== rows) {
          lastSizeRef.current = { cols, rows };
          window.nestbrain!.terminal.resize(sessionId, cols, rows);
        }
        // Force a full repaint — clears stray glyphs from any prior
        // hidden-state writes.
        term.refresh(0, rows - 1);
        term.focus();
      } catch {
        /* ignore */
      }
    }, 80);
    return () => clearTimeout(t1);
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
    window.nestbrain.terminal.write(sessionId, paths.join(" ") + " ");
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
      style={{ padding: "8px 8px 4px 8px" }}
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
