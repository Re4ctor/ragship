import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

function stringFromEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var ${name}: ${raw}`);
  }
  return parsed;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "docs-dir": { type: "string", short: "d" },
    "db-url": { type: "string" },
    "ollama-url": { type: "string" },
    "embedding-model": { type: "string" },
    "llm-model": { type: "string" },
    port: { type: "string", short: "p" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`ragship

Usage:
  npx ragship <docs-folder> [options]
  npx ragship --docs-dir ./docs --port 3000

Options:
  -d, --docs-dir <path>        Folder with Markdown files (default: ./docs)
  -p, --port <number>          HTTP server port (default: 3000)
  --db-url <url>               libSQL database URL (default: file:./data/rag.db)
  --ollama-url <url>           Ollama base URL (default: http://localhost:11434)
  --embedding-model <model>    Ollama embedding model (default: nomic-embed-text)
  --llm-model <model>          Ollama LLM model (default: llama3.2:1b)
  -h, --help                   Show this help

Env vars mirror the long option names with underscores and UPPERCASE, e.g.
  DOCS_DIR, PORT, OLLAMA_URL, EMBEDDING_MODEL, LLM_MODEL, DATABASE_URL`);
  process.exit(0);
}

const docsDir = path.resolve(values["docs-dir"] ?? positionals[0] ?? process.env.DOCS_DIR ?? "./docs");
const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");

export const config = {
  docsDir,
  dataDir,
  databaseUrl: stringFromEnv(
    "DATABASE_URL",
    values["db-url"] ?? `file:${path.join(dataDir, "rag.db")}`
  ),
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN,
  ollamaBaseUrl: stringFromEnv(
    "OLLAMA_BASE_URL",
    values["ollama-url"] ?? "http://localhost:11434"
  ).replace(/\/$/, ""),
  embeddingModel: stringFromEnv(
    "OLLAMA_EMBEDDING_MODEL",
    values["embedding-model"] ?? "nomic-embed-text"
  ),
  llmModel: stringFromEnv("OLLAMA_LLM_MODEL", values["llm-model"] ?? "llama3.2:1b"),
  serverHost: "0.0.0.0",
  serverPort: numberFromEnv("PORT", values.port ? Number(values.port) : 3000),

  chunkMinChars: numberFromEnv("CHUNK_MIN_CHARS", 1000),
  chunkMaxChars: numberFromEnv("CHUNK_MAX_CHARS", 2400),
  chunkOverlapChars: numberFromEnv("CHUNK_OVERLAP_CHARS", 350),
  ragTopK: numberFromEnv("RAG_TOP_K", 4),

  embeddingConcurrency: numberFromEnv("OLLAMA_EMBEDDING_CONCURRENCY", 2),
  embeddingMaxChars: numberFromEnv("OLLAMA_EMBEDDING_MAX_CHARS", 2500),
  ollamaNumCtx: numberFromEnv("OLLAMA_NUM_CTX", 2048),
  ollamaTemperature: numberFromEnv("OLLAMA_TEMPERATURE", 0.1),
  ollamaRetries: numberFromEnv("OLLAMA_RETRIES", 3),
  ollamaRetryBaseMs: numberFromEnv("OLLAMA_RETRY_BASE_MS", 500),
  databaseBusyRetries: numberFromEnv("DATABASE_BUSY_RETRIES", 8),
};
