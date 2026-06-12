// Module registry — open-core seam.
//
// A "module" is a paid capability pack (Enterprise add-on) layered on top of
// the knowledge core: Dev (terminal, Git, Projects), Anatomize (business
// document intelligence), and future ones. Entitlement is the intersection of
// (a) modules compiled into THIS build — official binaries carry them, source
// builds don't — and (b) `module:<id>` features in the org's signed license,
// which the Team Server hands to signed-in members and the licensing
// control-plane can change live via the rolling token.
//
// The build-time half of the gate comes from the private dev-impl overlay
// (see dev-module.ts): present in official builds, absent in public source
// builds — so there's nothing to "unlock" by patching a flag.

import { builtInModules } from "./dev-module";

/** Hard cap on simultaneously-loaded modules per client. */
export const MAX_ACTIVE_MODULES = 5;

/** Decode `module:*` features from a signed license token (payload.features). */
export function modulesFromLicense(token: string | null): string[] {
  if (!token) return [];
  try {
    const payloadB64 = token.split(".")[0];
    if (!payloadB64) return [];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      features?: unknown;
      exp?: unknown;
    };
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return [];
    const feats = Array.isArray(payload.features) ? (payload.features as string[]) : [];
    // Active = built into this binary ∩ licensed ∩ (future) the user's local
    // selection from Settings. An org may own any number of modules, but at
    // most MAX_ACTIVE_MODULES load simultaneously on a client; until the
    // selection UI ships, the first N licensed modules win.
    return builtInModules()
      .filter((m) => feats.includes(`module:${m}`))
      .slice(0, MAX_ACTIVE_MODULES);
  } catch {
    return [];
  }
}
