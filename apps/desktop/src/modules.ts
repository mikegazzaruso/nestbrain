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
// BUILT_IN_MODULES is the build-time half of the gate. In the public GPL repo
// it lists what still ships here; the private overlay replaces this file when
// packaging official binaries.

export const BUILT_IN_MODULES: readonly string[] = ["dev"];

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
    return BUILT_IN_MODULES.filter((m) => feats.includes(`module:${m}`));
  } catch {
    return [];
  }
}
