"use client";

// dev-besidetech — Besidetech's custom Dev module (starter).
//
// This page renders at /dev-besidetech. It is gated by the renderer's
// useModules() (the nav entry below only shows when this module is active),
// so you never need to gate inside the page. Build your custom developer
// surfaces here; add new API routes under app/api/dev-besidetech/.
//
// To see it locally without a licensed Team Server:
//   bash scripts/module-dev.sh dev-besidetech     (in the public nestbrain repo)
// which overlays your module and sets NESTBRAIN_DEV_MODULES=dev-besidetech.

import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

export default function DevBesidetechPage() {
  const [pong, setPong] = useState<string>("…");

  useEffect(() => {
    fetch("/api/dev-besidetech/ping")
      .then((r) => r.json())
      .then((d: { pong?: string }) => setPong(d.pong ?? "no reply"))
      .catch(() => setPong("error"));
  }, []);

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-10">
      <div className="flex items-center gap-3 mb-6">
        <span className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center">
          <Wrench size={20} className="text-accent" />
        </span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Dev · Besidetech</h1>
          <p className="text-xs text-muted">Your custom developer module — start building here.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <p className="text-sm">
          API round-trip: <span className="font-mono text-accent">{pong}</span>
        </p>
      </div>
    </div>
  );
}
