import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateId, slugify, buildFrontmatter, nowISO } from "./utils";
import type { IngestResult } from "./index";

export async function ingestGithub(
  repoUrl: string,
  rawPath: string,
): Promise<IngestResult> {
  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`;

  // Fetch repo metadata
  const metaRes = await fetch(apiBase, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!metaRes.ok) throw new Error(`GitHub API error: ${metaRes.status}`);
  const meta = await metaRes.json();

  // Fetch README
  let readme = "";
  try {
    const readmeRes = await fetch(`${apiBase}/readme`, {
      headers: { Accept: "application/vnd.github.v3.raw" },
    });
    if (readmeRes.ok) readme = await readmeRes.text();
  } catch {
    // No README
  }

  // Fetch key files (package.json, Cargo.toml, pyproject.toml, etc.)
  const keyFiles: string[] = [];
  const filesToTry = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "Makefile"];
  for (const file of filesToTry) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repoName}/${meta.default_branch}/${file}`);
      if (res.ok) {
        const content = await res.text();
        keyFiles.push(`### ${file}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
      }
    } catch {
      // skip
    }
  }

  // Fetch tree to get directory structure
  let treeStr = "";
  try {
    const treeRes = await fetch(`${apiBase}/git/trees/${meta.default_branch}?recursive=1`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      const paths = (treeData.tree as Array<{ path: string; type: string }>)
        .filter((t) => t.type === "blob")
        .map((t) => t.path)
        .slice(0, 100);
      treeStr = "```\n" + paths.join("\n") + "\n```";
    }
  } catch {
    // skip
  }

  const title = meta.full_name ?? `${owner}/${repoName}`;
  const id = generateId();
  const slug = slugify(repoName);
  const fileName = `${slug}-${id}.md`;
  const filePath = join(rawPath, fileName);

  const frontmatter = buildFrontmatter({
    id,
    title,
    sourceType: "github",
    sourceUrl: repoUrl,
    ingestedAt: nowISO(),
    stars: String(meta.stargazers_count ?? 0),
    language: meta.language ?? "unknown",
    tags: (meta.topics ?? []).slice(0, 10),
    checksum: "",
  });

  const content = `${frontmatter}

# ${title}

${meta.description ?? ""}

- **Language:** ${meta.language ?? "N/A"}
- **Stars:** ${meta.stargazers_count ?? 0}
- **Forks:** ${meta.forks_count ?? 0}
- **License:** ${meta.license?.name ?? "N/A"}
- **URL:** ${meta.html_url}

## README

${readme || "_No README found._"}

${keyFiles.length > 0 ? "## Key Files\n\n" + keyFiles.join("\n\n") : ""}

${treeStr ? "## File Structure\n\n" + treeStr : ""}
`;

  await writeFile(filePath, content, "utf-8");

  return { filePath: fileName, title, sourceType: "github" };
}
