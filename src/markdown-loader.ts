import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";
import { config } from "./config.js";
import type { MarkdownDocument } from "./types.js";
import { hash } from "./utils/hash.js";

function firstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function titleFromFile(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  if (basename.toLowerCase() !== "index") return basename;
  return path.basename(path.dirname(filePath));
}

function normalizeRelativePath(filePath: string, docsDir: string): string {
  return path.relative(docsDir, filePath).split(path.sep).join("/");
}

function metadataString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function loadMarkdownDocuments(docsDir = config.docsDir): Promise<MarkdownDocument[]> {
  const pattern = path.join(docsDir, "**/*.md").split(path.sep).join("/");
  const files = await glob(pattern, {
    nodir: true,
    absolute: true,
    ignore: ["**/node_modules/**", "**/data/**"]
  });

  const documents: MarkdownDocument[] = [];

  for (const filePath of files.sort()) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const relativePath = normalizeRelativePath(filePath, docsDir);
    const title = metadataString(parsed.data.title) ?? firstHeading(parsed.content) ?? titleFromFile(filePath);
    const page = metadataString(parsed.data.page) ?? title;
    const space = metadataString(parsed.data.space) ?? relativePath.split("/")[0];
    const source = metadataString(parsed.data.source) ?? "local";
    const section = metadataString(parsed.data.section);

    documents.push({
      id: hash(relativePath),
      title,
      content: parsed.content.trim(),
      contentHash: hash(
        parsed.content.trim() +
        JSON.stringify({
          min: config.chunkMinChars,
          max: config.chunkMaxChars,
          overlap: config.chunkOverlapChars
        })
      ),
      filePath,
      relativePath,
      source,
      space,
      page,
      section
    });
  }

  return documents;
}
