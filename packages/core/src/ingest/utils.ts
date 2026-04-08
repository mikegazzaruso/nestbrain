import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import type { SourceType } from "@mindnest/shared";

export function generateId(): string {
  return uuidv4().slice(0, 8);
}

export async function computeChecksum(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function detectSourceType(source: string): SourceType {
  if (source.match(/^https?:\/\//)) {
    if (source.includes("github.com")) return "github";
    if (source.includes("arxiv.org")) return "arxiv";
    if (source.includes("youtube.com") || source.includes("youtu.be")) return "youtube";
    return "url";
  }
  if (source.endsWith(".pdf")) return "pdf";
  if (source.endsWith(".md") || source.endsWith(".markdown")) return "markdown";
  return "markdown";
}

export function buildFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const line of value.split("\n")) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`${key}: "${value}"`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function nowISO(): string {
  return new Date().toISOString().split("T")[0];
}
