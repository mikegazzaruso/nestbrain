import { resolve } from "node:path";

export function getDataPaths() {
  const base = resolve(process.cwd(), "../../data");
  return {
    rawPath: resolve(base, "raw"),
    wikiPath: resolve(base, "wiki"),
  };
}
