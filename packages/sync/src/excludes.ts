// Exclude rules for the sync walker.
//
// Path matching is intentionally simple: we operate on POSIX-style relative
// paths. A rule matches if the path equals it, starts with it followed by "/",
// or — when the rule begins with "**/" — matches at any depth.

export interface ExcludeOptions {
  includeProjects: boolean;
  /** Optional extra patterns from a .nestbrainsync-ignore file. */
  extra?: string[];
}

// Build artifacts, VCS dirs, OS junk — never sync these.
const ALWAYS_EXCLUDE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  ".DS_Store",
  "Thumbs.db",
];

// Inside the NestBrain hidden state dir, most things should NOT sync.
// Settings contain the user's OpenAI key, the vector index is regenerable,
// and our own manifest must not sync itself.
const NESTBRAIN_INTERNAL_EXCLUDE = [
  ".nestbrain/settings.json",
  ".nestbrain/vector-index",
  ".nestbrain/sync-manifest.json",
  ".nestbrain/data-tmp",
];

// Anything that looks like a secrets file, plus generic transient artifacts.
const SECRET_PATTERNS = [
  "**/.env",
  "**/.env.local",
  "**/.env.development",
  "**/.env.production",
  "**/auth.enc",
  // Transient temp files written by atomic-rename patterns — never sync these.
  "**/*.tmp",
  "**/*.swp",
];

export function buildExcludes(opts: ExcludeOptions): (relPath: string) => boolean {
  const segments = [...ALWAYS_EXCLUDE];
  const exact = [...NESTBRAIN_INTERNAL_EXCLUDE];
  const globs = [...SECRET_PATTERNS, ...(opts.extra ?? [])];

  if (!opts.includeProjects) exact.push("Projects");

  return (relPath: string): boolean => {
    const parts = relPath.split("/");

    // ALWAYS_EXCLUDE: any path segment named `node_modules` etc.
    for (const seg of segments) {
      if (parts.includes(seg)) return true;
    }

    // Exact-prefix matches (paths that equal the rule or live under it).
    for (const rule of exact) {
      if (relPath === rule || relPath.startsWith(rule + "/")) return true;
    }

    // Glob-style. Supported forms:
    //   "**/foo"     → matches any path whose last segment equals "foo"
    //   "**/*.tmp"   → matches any path whose last segment ends with ".tmp"
    //   "anything else" → exact path or prefix
    const lastPart = parts[parts.length - 1];
    for (const g of globs) {
      if (g.startsWith("**/*.")) {
        const suffix = g.slice(4); // ".tmp"
        if (lastPart.endsWith(suffix)) return true;
      } else if (g.startsWith("**/")) {
        const target = g.slice(3);
        if (lastPart === target) return true;
      } else if (relPath === g || relPath.startsWith(g + "/")) {
        return true;
      }
    }

    return false;
  };
}
