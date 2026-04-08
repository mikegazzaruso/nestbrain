"use client";

import { useCompile } from "@/lib/compile-context";
import { RefreshCw } from "lucide-react";

export function CompileIndicator() {
  const { status, message, phase, compile } = useCompile();

  return (
    <div className="px-4 py-3 border-b border-sidebar-border">
      <button
        onClick={() => compile()}
        disabled={status === "compiling"}
        className="w-full flex items-center gap-2.5 group disabled:cursor-wait"
      >
        {/* Status dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          {status === "compiling" && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              status === "idle"
                ? "bg-muted/30"
                : status === "compiling"
                  ? "bg-amber-500 animate-pulse"
                  : status === "success"
                    ? "bg-green-500"
                    : "bg-red-500"
            }`}
          />
        </span>

        {/* Label */}
        <span className="flex-1 text-left text-[11px] truncate">
          {status === "idle" && (
            <span className="text-muted/50 group-hover:text-muted transition-colors">
              Ready to compile
            </span>
          )}
          {status === "compiling" && (
            <span className="text-amber-400/90">Compiling...</span>
          )}
          {status === "success" && (
            <span className="text-green-400/80">{message}</span>
          )}
          {status === "error" && (
            <span className="text-red-400/80 truncate" title={message}>
              {message}
            </span>
          )}
        </span>

        {/* Icon */}
        <RefreshCw
          size={11}
          className={`shrink-0 ${
            status === "compiling"
              ? "text-amber-400 animate-spin"
              : "text-muted/30 group-hover:text-muted transition-colors"
          }`}
        />
      </button>

      {/* Phase detail */}
      {status === "compiling" && phase && (
        <p className="text-[10px] text-amber-400/50 mt-1.5 pl-[18px] truncate">
          {phase}
        </p>
      )}
    </div>
  );
}
