// Runtime loader for native/CJS packages that must bypass Turbopack bundling.
// Turbopack aggressively analyzes require() and import() calls to trace
// dependencies, even for the values stored in `createRequire(...)`. To
// completely hide the require calls from static analysis we build the loader
// functions with `new Function(...)` — Turbopack treats the body as an opaque
// string so the package names never enter its dependency graph.
//
// Required for:
//   - @huggingface/transformers: .mjs entry has an ESM↔CJS interop issue
//     with onnxruntime-common; .cjs entry works via require().
//   - pdf-parse: pdfjs-dist's ESM entry crashes on missing DOMMatrix globals;
//     .cjs entry works via require().
import { createRequire } from "node:module";
import {
  registerTransformersLoader,
  registerPdfParseLoader,
} from "@nestbrain/core";

const nodeRequire = createRequire(import.meta.url);

// Build loader functions via `new Function` so Turbopack can't statically
// detect the require targets. The bodies are plain strings to the analyzer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadTransformers: () => any = new Function(
  "req",
  "return function(){return req('@hug' + 'gingface/transformers');}",
)(nodeRequire);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadPdfParse: () => any = new Function(
  "req",
  "return function(){return req('pdf' + '-parse');}",
)(nodeRequire);

let registered = false;

export function ensureNativeLoadersRegistered(): void {
  if (registered) return;
  registered = true;
  registerTransformersLoader(loadTransformers);
  registerPdfParseLoader(loadPdfParse);
}
