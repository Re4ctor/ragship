import { createClient, type Client, type InArgs } from "@libsql/client";
import { config } from "./config.js";
import { float32ArrayToBuffer } from "./embeddings.js";
import type { DocumentChunk, MarkdownDocument, SimilarChunk } from "./types.js";

let db: Client | undefined;

type Statement = {
  sql: string;
  args?: InArgs;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SQLITE_BUSY") || message.includes("database is locked");
}

export async function executeWithRetry(statement: string | Statement) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.databaseBusyRetries; attempt += 1) {
    try {
      return await getDb().execute(statement as never);
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt >= config.databaseBusyRetries) break;
      await sleep(250 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function batchWithRetry(statements: Statement[], mode: "read" | "write") {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.databaseBusyRetries; attempt += 1) {
    try {
      return await getDb().batch(statements, mode);
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt >= config.databaseBusyRetries) break;
      await sleep(250 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function getDb(): Client {
  if (!db) {
    db = createClient({
      url: config.databaseUrl,
      authToken: config.databaseAuthToken
    });
  }
  return db;
}

export async function checkDb(): Promise<boolean> {
  try {
    await executeWithRetry("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function upsertDocument(document: MarkdownDocument): Promise<void> {
  await executeWithRetry({
    sql: `INSERT INTO documents (id, title, relative_path, space, page, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            relative_path = excluded.relative_path,
            space = excluded.space,
            page = excluded.page,
            source = excluded.source,
            updated_at = CURRENT_TIMESTAMP`,
    args: [document.id, document.title, document.relativePath, document.space ?? null, document.page ?? null, document.source]
  });
}

export async function getDocumentHashes(): Promise<Map<string, string | null>> {
  const result = await executeWithRetry({
    sql: "SELECT id, content_hash FROM documents",
    args: []
  });
  const map = new Map<string, string | null>();
  for (const row of result.rows) {
    map.set(String(row.id), row.content_hash === undefined || row.content_hash === null ? null : String(row.content_hash));
  }
  return map;
}

export async function replaceDocumentChunks(
  document: MarkdownDocument,
  chunks: Array<{ chunk: DocumentChunk; embedding: number[] }>,
  contentHash?: string
): Promise<void> {
  const statements = [
    {
      sql: "DELETE FROM chunks WHERE document_id = ?",
      args: [document.id]
    },
    ...chunks.map(({ chunk, embedding }) => ({
      sql: `INSERT INTO chunks (
              id, document_id, section, content, chunk_index, token_estimate, embedding, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        chunk.id,
        chunk.documentId,
        chunk.section ?? null,
        chunk.content,
        chunk.chunkIndex,
        chunk.tokenEstimate,
        float32ArrayToBuffer(embedding)
      ]
    })),
    ...(contentHash !== undefined
      ? [{
          sql: "UPDATE documents SET content_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [contentHash, document.id]
        }]
      : [])
  ];

  await batchWithRetry(statements, "write");
}

function rowToSimilarChunk(row: Record<string, unknown>): SimilarChunk {
  const distance = Number(row.distance);
  return {
    id: String(row.id),
    content: String(row.content),
    section: row.section === null || row.section === undefined ? null : String(row.section),
    title: String(row.title),
    relativePath: String(row.relative_path),
    distance,
    score: Math.max(0, Math.min(1, 1 - distance))
  };
}

export async function searchSimilarChunks(questionEmbedding: number[], topK = config.ragTopK): Promise<SimilarChunk[]> {
  const db = getDb();
  const embeddingBuffer = float32ArrayToBuffer(questionEmbedding);

  try {
    const result = await db.execute({
      sql: `SELECT
              chunks.id,
              chunks.content,
              chunks.section,
              documents.title,
              documents.relative_path,
              vector_distance_cos(chunks.embedding, ?) AS distance
            FROM vector_top_k('chunks_embedding_idx', ?, ?) AS v
            JOIN chunks ON chunks.rowid = v.id
            JOIN documents ON documents.id = chunks.document_id
            ORDER BY distance ASC
            LIMIT ?`,
      args: [embeddingBuffer, embeddingBuffer, topK, topK]
    });
    return result.rows.map((row) => rowToSimilarChunk(row as Record<string, unknown>));
  } catch {
    const result = await db.execute({
      sql: `SELECT
              chunks.id,
              chunks.content,
              chunks.section,
              documents.title,
              documents.relative_path,
              vector_distance_cos(chunks.embedding, ?) AS distance
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            WHERE chunks.embedding IS NOT NULL
            ORDER BY distance ASC
            LIMIT ?`,
      args: [embeddingBuffer, topK]
    });
    return result.rows.map((row) => rowToSimilarChunk(row as Record<string, unknown>));
  }
}
