import { batchWithRetry, executeWithRetry, getDb } from "./db.js";
import { embedText } from "./ollama.js";
import { logger } from "./utils/logger.js";

const VECTOR_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks(libsql_vector_idx(embedding))";

export async function initializeSchema(embeddingDimension: number): Promise<void> {
  if (!Number.isInteger(embeddingDimension) || embeddingDimension <= 0) {
    throw new Error(`Invalid embedding dimension: ${embeddingDimension}`);
  }

  await executeWithRetry({ sql: "PRAGMA journal_mode = WAL" });

  const schemaStatements = [
    { sql: "PRAGMA foreign_keys = ON" },
    { sql: `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        space TEXT,
        page TEXT,
        source TEXT DEFAULT 'xwiki',
        content_hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )` },
    { sql: `CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        section TEXT,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        token_estimate INTEGER,
        embedding F32_BLOB(${embeddingDimension}),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      )` },
    { sql: `CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )` },
    { sql: "CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id)" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_chunks_section ON chunks(section)" },
    { sql: "CREATE INDEX IF NOT EXISTS idx_documents_relative_path ON documents(relative_path)" }
  ];

  await batchWithRetry(schemaStatements, "write");

  try {
    await executeWithRetry({ sql: "ALTER TABLE documents ADD COLUMN content_hash TEXT" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate column")) {
      throw error;
    }
  }

  const existingDimension = await getEmbeddingDimension();
  if (existingDimension !== undefined && existingDimension !== embeddingDimension) {
    throw new Error(
      `Embedding dimension mismatch: database has ${existingDimension}, current model returned ${embeddingDimension}. Recreate the DB or use the original embedding model.`
    );
  }

  await executeWithRetry({
    sql: `INSERT INTO schema_meta (key, value, updated_at)
          VALUES ('embedding_dimension', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    args: [String(embeddingDimension)]
  });

  await ensureVectorIndex();
}

export async function ensureVectorIndex(): Promise<void> {
  try {
    await executeWithRetry({ sql: VECTOR_INDEX_SQL });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Vector index creation skipped or failed: ${message}`);
  }
}

export async function getEmbeddingDimension(): Promise<number | undefined> {
  try {
    const result = await executeWithRetry({
      sql: "SELECT value FROM schema_meta WHERE key = 'embedding_dimension'",
      args: []
    });
    const value = result.rows[0]?.value;
    if (typeof value === "string") return Number(value);
    if (typeof value === "number") return value;
    return undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vector = await embedText("test embedding dimension");
  await initializeSchema(vector.length);
  logger.info(`Schema initialized. Embedding dimension: ${vector.length}`);
}
