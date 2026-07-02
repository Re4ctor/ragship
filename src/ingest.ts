import fs from "node:fs/promises";
import { config } from "./config.js";
import { chunkDocument } from "./chunker.js";
import { embedText } from "./ollama.js";
import { loadMarkdownDocuments } from "./markdown-loader.js";
import { initializeSchema } from "./schema.js";
import { getDocumentHashes, replaceDocumentChunks, upsertDocument } from "./db.js";
import { logger } from "./utils/logger.js";
import type { DocumentChunk, MarkdownDocument } from "./types.js";

function buildEmbeddingInput(chunk: { title: string; section?: string; relativePath: string; content: string }): string {
  const header = [`Titolo: ${chunk.title}`, `Sezione: ${chunk.section ?? ""}`, `File: ${chunk.relativePath}`, ""].join("\n");
  const maxContentChars = Math.max(500, config.embeddingMaxChars - header.length);
  const content = chunk.content.length > maxContentChars ? chunk.content.slice(0, maxContentChars) : chunk.content;
  return `${header}${content}`;
}

type EmbeddingTask = {
  document: MarkdownDocument;
  chunk: DocumentChunk;
  input: string;
  embedding?: number[];
  error?: string;
};

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function ingest(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });

  const testEmbedding = await embedText("dimension probe");
  await initializeSchema(testEmbedding.length);

  const documents = await loadMarkdownDocuments();
  const existingHashes = await getDocumentHashes();
  let chunkCount = 0;
  let indexedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ path: string; error: string }> = [];
  const tasks: EmbeddingTask[] = [];
  const tasksByDocument = new Map<string, EmbeddingTask[]>();
  const pendingByDocument = new Map<string, number>();

  for (const document of documents) {
    try {
      const existingHash = existingHashes.get(document.id);
      const isUnchanged = document.contentHash !== undefined && existingHash === document.contentHash;

      await upsertDocument(document);

      if (isUnchanged) {
        skippedCount += 1;
        logger.info(`Skipped ${document.relativePath}: content unchanged`);
        continue;
      }

      const chunks = chunkDocument(document);
      chunkCount += chunks.length;

      const docTasks: EmbeddingTask[] = [];
      for (const chunk of chunks) {
        const task: EmbeddingTask = { document, chunk, input: buildEmbeddingInput(chunk) };
        tasks.push(task);
        docTasks.push(task);
      }
      tasksByDocument.set(document.id, docTasks);
      pendingByDocument.set(document.id, docTasks.length);
    } catch (error) {
      errors.push({
        path: document.relativePath,
        error: error instanceof Error ? error.message : String(error)
      });
      logger.error(`Failed ${document.relativePath}`, errors.at(-1));
    }
  }

  await runWithConcurrency(tasks, config.embeddingConcurrency, async (task) => {
    try {
      task.embedding = await embedText(task.input);
    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
    }

    const docId = task.document.id;
    const remaining = (pendingByDocument.get(docId) ?? 1) - 1;
    pendingByDocument.set(docId, remaining);

    if (remaining === 0) {
      const docTasks = tasksByDocument.get(docId) ?? [];
      const embeddedChunks = [];
      let docError: string | undefined;

      for (const t of docTasks) {
        if (t.error) {
          docError = t.error;
          break;
        }
        if (t.embedding) {
          embeddedChunks.push({ chunk: t.chunk, embedding: t.embedding });
        }
      }

      if (docError) {
        errors.push({ path: task.document.relativePath, error: docError });
        logger.error(`Failed embedding ${task.document.relativePath}`, errors.at(-1));
        return;
      }

      try {
        await replaceDocumentChunks(task.document, embeddedChunks, task.document.contentHash);
        indexedCount += embeddedChunks.length;
        logger.info(`Indexed ${task.document.relativePath}: ${embeddedChunks.length} chunks`);
      } catch (error) {
        errors.push({
          path: task.document.relativePath,
          error: error instanceof Error ? error.message : String(error)
        });
        logger.error(`Failed ${task.document.relativePath}`, errors.at(-1));
      }
    }
  });

  logger.info("Ingest completed");
  logger.info(`Documents read: ${documents.length}`);
  logger.info(`Documents skipped: ${skippedCount}`);
  logger.info(`Chunks created: ${chunkCount}`);
  logger.info(`Chunks indexed: ${indexedCount}`);
  logger.info(`Embedding dimension: ${testEmbedding.length}`);
  logger.info(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    logger.error("Ingest errors", errors);
    throw new Error(`Ingest completed with ${errors.length} errors`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await ingest();
}
