import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import type { LintFinding } from "@mindnest/shared";
import { WIKI_DIRS } from "@mindnest/shared";
import type { LLMProviderInterface } from "../llm/provider";
import { nowISO, buildFrontmatter } from "../ingest/utils";

export interface LintOptions {
  wikiPath?: string;
  llm?: LLMProviderInterface;
}

export interface LintReport {
  findings: LintFinding[];
  stats: {
    totalArticles: number;
    orphans: number;
    missingBacklinks: number;
    suggestedArticles: number;
  };
  generatedAt: string;
}

interface ArticleInfo {
  id: string;
  title: string;
  filePath: string;
  dir: string;
  tags: string[];
  outlinks: string[];
  backlinks: string[];
  hasContent: boolean;
}

export async function lint(options?: LintOptions): Promise<LintReport> {
  const wikiPath = resolve(options?.wikiPath ?? "./data/wiki");

  // Collect all articles
  const articles: ArticleInfo[] = [];
  const allIds = new Set<string>();

  for (const dir of [WIKI_DIRS.sources, WIKI_DIRS.concepts, WIKI_DIRS.outputs]) {
    const dirPath = join(wikiPath, dir);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(dirPath, file), "utf-8");
      const id = basename(file, ".md");
      allIds.add(id);

      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      const tagsMatch = content.match(/tags:\s*\[([^\]]*)\]/);
      const body = content.replace(/^---[\s\S]*?---\n*/, "");

      // Extract outgoing wikilinks
      const outlinks: string[] = [];
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let m;
      while ((m = linkRegex.exec(body)) !== null) {
        const target = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const clean = target.includes("/") ? target.split("/").pop()! : target;
        if (!outlinks.includes(clean)) outlinks.push(clean);
      }

      const tags = tagsMatch
        ? tagsMatch[1].split(",").map((t) => t.trim().replace(/["\[\]]/g, "")).filter(Boolean)
        : [];

      articles.push({
        id,
        title: titleMatch?.[1] ?? id,
        filePath: `${dir}/${file}`,
        dir,
        tags,
        outlinks,
        backlinks: [],
        hasContent: body.trim().length > 50,
      });
    }
  }

  // Build backlinks
  for (const article of articles) {
    for (const targetId of article.outlinks) {
      const target = articles.find((a) => a.id === targetId || a.id.includes(targetId) || targetId.includes(a.id));
      if (target) {
        if (!target.backlinks.includes(article.id)) {
          target.backlinks.push(article.id);
        }
      }
    }
  }

  const findings: LintFinding[] = [];

  // 1. Orphan detection — articles with no backlinks (except root index files)
  const orphans = articles.filter((a) => a.backlinks.length === 0 && a.dir !== WIKI_DIRS.outputs);
  for (const orphan of orphans) {
    findings.push({
      severity: "warning",
      category: "orphan",
      message: `"${orphan.title}" has no backlinks — nothing links to it`,
      filePath: orphan.filePath,
    });
  }

  // 2. Broken links — wikilinks pointing to non-existent articles
  for (const article of articles) {
    for (const targetId of article.outlinks) {
      const exists = articles.some((a) => a.id === targetId || a.id.includes(targetId) || targetId.includes(a.id));
      if (!exists) {
        findings.push({
          severity: "warning",
          category: "missing-data",
          message: `"${article.title}" links to "[[${targetId}]]" which doesn't exist`,
          filePath: article.filePath,
        });
      }
    }
  }

  // 3. Empty or stub articles
  const stubs = articles.filter((a) => !a.hasContent);
  for (const stub of stubs) {
    findings.push({
      severity: "info",
      category: "missing-data",
      message: `"${stub.title}" appears to be a stub (very little content)`,
      filePath: stub.filePath,
    });
  }

  // 4. Articles without tags
  const untagged = articles.filter((a) => a.tags.length === 0 && a.dir === WIKI_DIRS.concepts);
  for (const a of untagged) {
    findings.push({
      severity: "info",
      category: "missing-data",
      message: `"${a.title}" has no tags`,
      filePath: a.filePath,
    });
  }

  // 5. Gap analysis — find frequently linked but non-existent concepts
  const linkedButMissing = new Map<string, number>();
  for (const article of articles) {
    for (const targetId of article.outlinks) {
      const exists = articles.some((a) => a.id === targetId || a.id.includes(targetId) || targetId.includes(a.id));
      if (!exists) {
        linkedButMissing.set(targetId, (linkedButMissing.get(targetId) ?? 0) + 1);
      }
    }
  }
  const suggestedArticles: Array<{ name: string; count: number }> = [];
  for (const [name, count] of linkedButMissing) {
    if (count >= 2) {
      suggestedArticles.push({ name, count });
      findings.push({
        severity: "info",
        category: "gap",
        message: `Suggested new article: "${name}" — referenced by ${count} articles but doesn't exist`,
      });
    }
  }

  // 6. LLM-powered inconsistency detection (if LLM available)
  if (options?.llm && articles.length > 1) {
    const conceptSummaries = articles
      .filter((a) => a.dir === WIKI_DIRS.concepts && a.hasContent)
      .slice(0, 20)
      .map((a) => `- ${a.title}`);

    if (conceptSummaries.length > 3) {
      try {
        const response = await options.llm.ask(
          `Here are the concepts in a knowledge base:\n\n${conceptSummaries.join("\n")}\n\nIdentify any potential inconsistencies, overlaps, or contradictions between these concepts. List only clear issues, not speculative ones. If there are no issues, say "No inconsistencies found." Be concise.`,
          "You are a knowledge base auditor. Identify inconsistencies between concepts. Be brief and specific.",
        );

        if (response.text && !response.text.toLowerCase().includes("no inconsistencies")) {
          findings.push({
            severity: "warning",
            category: "inconsistency",
            message: response.text.slice(0, 500),
          });
        }
      } catch {
        // LLM call failed, skip
      }
    }
  }

  // Generate report file
  const report = `${buildFrontmatter({
    title: "Wiki Health Report",
    created: nowISO(),
    updated: nowISO(),
    type: "lint-report",
    tags: ["lint", "health"],
    summary: `${findings.length} findings across ${articles.length} articles`,
  })}

# Wiki Health Report

Generated: ${new Date().toISOString()}

## Summary

- **Total articles:** ${articles.length}
- **Orphans (no backlinks):** ${orphans.length}
- **Broken links:** ${findings.filter((f) => f.category === "missing-data" && f.message.includes("doesn't exist")).length}
- **Suggested new articles:** ${suggestedArticles.length}
- **Total findings:** ${findings.length}

## Findings

${findings.length === 0 ? "_No issues found. Your wiki is healthy!_" : ""}

${findings.filter((f) => f.severity === "error").map((f) => `### Error\n${f.message}${f.filePath ? ` — \`${f.filePath}\`` : ""}`).join("\n\n")}

${findings.filter((f) => f.severity === "warning").map((f) => `### Warning\n${f.message}${f.filePath ? ` — \`${f.filePath}\`` : ""}`).join("\n\n")}

${findings.filter((f) => f.severity === "info").map((f) => `- ${f.message}${f.filePath ? ` (\`${f.filePath}\`)` : ""}`).join("\n")}

${suggestedArticles.length > 0 ? `## Suggested New Articles\n\n${suggestedArticles.sort((a, b) => b.count - a.count).map((s) => `- **${s.name}** — referenced ${s.count} times`).join("\n")}` : ""}
`;

  // Save report
  const outputsDir = join(wikiPath, WIKI_DIRS.outputs);
  await mkdir(outputsDir, { recursive: true });
  await writeFile(join(outputsDir, "health-report.md"), report, "utf-8");

  return {
    findings,
    stats: {
      totalArticles: articles.length,
      orphans: orphans.length,
      missingBacklinks: findings.filter((f) => f.category === "missing-data").length,
      suggestedArticles: suggestedArticles.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
