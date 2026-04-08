// Server-side compile state — singleton across requests

export type CompileStatus = "idle" | "compiling" | "success" | "error";

export interface CompileStateData {
  status: CompileStatus;
  message: string;
  phase: string;
  startedAt: number | null;
  finishedAt: number | null;
}

const state: CompileStateData = {
  status: "idle",
  message: "",
  phase: "",
  startedAt: null,
  finishedAt: null,
};

export function getCompileState(): CompileStateData {
  return { ...state };
}

export function setCompileState(update: Partial<CompileStateData>): void {
  Object.assign(state, update);
}
