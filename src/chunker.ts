import { config } from "./config.js";
import type { DocumentChunk, MarkdownDocument } from "./types.js";
import { estimateTokens } from "./embeddings.js";
import { hash } from "./utils/hash.js";

type SectionBlock = {
  section?: string;
  text: string;
};

function splitByHeading(content: string, fallbackSection?: string): SectionBlock[] {
  const lines = content.split(/\r?\n/);
  const sections: SectionBlock[] = [];
  let currentTitle = fallbackSection;
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text.length > 0) {
      sections.push({ section: currentTitle, text });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)\s*$/);
    if (heading) {
      flush();
      currentTitle = heading[2]?.trim();
    }
    currentLines.push(line);
  }

  flush();
  return sections;
}

function overlapText(text: string): string {
  if (config.chunkOverlapChars <= 0) return "";
  return text.slice(Math.max(0, text.length - config.chunkOverlapChars));
}

function splitLargeBlock(text: string): string[] {
  const chunks: string[] = [];
  let offset = 0;

  while (offset < text.length) {
    const targetEnd = Math.min(offset + config.chunkMaxChars, text.length);
    let end = targetEnd;

    if (targetEnd < text.length) {
      const boundary = text.lastIndexOf("\n\n", targetEnd);
      if (boundary > offset + config.chunkMinChars) end = boundary;
    }

    const part = text.slice(offset, end).trim();
    if (part.length > 0) chunks.push(part);
    if (end >= text.length) break;
    offset = Math.max(end - config.chunkOverlapChars, offset + 1);
  }

  return chunks;
}

function pushBoundedChunk(target: Array<{ section?: string; content: string }>, section: string | undefined, content: string): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) return;

  if (trimmed.length <= config.chunkMaxChars) {
    target.push({ section, content: trimmed });
    return;
  }

  for (const part of splitLargeBlock(trimmed)) {
    target.push({ section, content: part });
  }
}

export function chunkDocument(document: MarkdownDocument): DocumentChunk[] {
  const blocks = splitByHeading(document.content, document.section ?? document.title);
  const chunkTexts: Array<{ section?: string; content: string }> = [];
  let current = "";
  let currentSection: string | undefined = document.section ?? document.title;

  const flush = () => {
    const content = current.trim();
    pushBoundedChunk(chunkTexts, currentSection, content);
    current = "";
  };

  for (const block of blocks) {
    if (block.text.length > config.chunkMaxChars) {
      flush();
      pushBoundedChunk(chunkTexts, block.section ?? currentSection, block.text);
      currentSection = block.section ?? currentSection;
      continue;
    }

    const next = current.length > 0 ? `${current}\n\n${block.text}` : block.text;
    if (next.length > config.chunkMaxChars) {
      const previous = current;
      flush();
      const overlap = overlapText(previous);
      const nextWithOverlap = overlap ? `${overlap}\n\n${block.text}` : block.text;
      if (nextWithOverlap.length > config.chunkMaxChars) {
        pushBoundedChunk(chunkTexts, block.section ?? currentSection, nextWithOverlap);
        current = "";
      } else {
        current = nextWithOverlap;
      }
    } else {
      current = next;
    }
    currentSection = block.section ?? currentSection;
  }

  flush();

  return chunkTexts
    .filter((chunk) => chunk.content.trim().length > 0)
    .map((chunk, chunkIndex) => ({
      id: hash(`${document.relativePath}:${chunkIndex}:${chunk.content}`),
      documentId: document.id,
      title: document.title,
      relativePath: document.relativePath,
      section: chunk.section,
      content: chunk.content,
      chunkIndex,
      tokenEstimate: estimateTokens(chunk.content)
    }));
}
