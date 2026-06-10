"use client";

import { useEffect, useState } from "react";

/**
 * True while a Team Server (Enterprise) session is connected. When it is,
 * Google Drive sync is disabled — the Team Server owns Library/Knowledge, and
 * two engines writing the same tree would fight. Used to gate the Drive sync UI
 * and the top-bar Google sign-in.
 */
export function useTeamConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const team = typeof window !== "undefined" ? window.nestbrain?.team : null;
    if (!team) return;
    team.getState().then((s) => setConnected(s?.status === "connected")).catch(() => {});
    const off = team.onStateChanged((s) => setConnected(s?.status === "connected"));
    return () => off?.();
  }, []);

  return connected;
}
