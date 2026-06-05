import type { NextConfig } from "next";
import { resolve } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("./package.json") as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  // Inject the app version at build time so UI surfaces (sidebar footer,
  // settings about block, etc.) always reflect what was actually shipped.
  // Bumping the version in package.json is the single source of truth.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Treat these as externals so Next.js doesn't touch them at bundle time —
  // they stay in node_modules and are require()'d at runtime.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-common",
    "sharp",
  ],
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
