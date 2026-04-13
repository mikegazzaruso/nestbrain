import { resolve } from "node:path";

export function getDataDir(): string {
  if (process.env.NESTBRAIN_DATA_DIR) {
    return resolve(process.env.NESTBRAIN_DATA_DIR);
  }
  return resolve(process.cwd(), "../../data");
}

export function getDataPaths() {
  const base = getDataDir();
  // Wiki is persisted in the user-visible NestBrain/Library/Knowledge folder
  // when running inside the Electron app. Fall back to $DATA_DIR/wiki for
  // the web/dev mode where no NestBrain layout exists.
  const wikiPath = process.env.NESTBRAIN_WIKI_DIR
    ? resolve(process.env.NESTBRAIN_WIKI_DIR)
    : resolve(base, "wiki");
  return {
    rawPath: resolve(base, "raw"),
    wikiPath,
  };
}
