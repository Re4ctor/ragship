#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import { initializeSchema } from "./schema.js";
import { ingest } from "./ingest.js";
import { server } from "./server.js";
import { checkOllama, embedText, ensureModel } from "./ollama.js";
import { logger } from "./utils/logger.js";

function runCommand(cmd: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function localDatabasePath(databaseUrl: string): string | undefined {
  if (!databaseUrl.startsWith("file:")) return undefined;
  return databaseUrl.slice("file:".length).split("?")[0];
}

async function ensureRuntimeFolders(): Promise<void> {
  const databasePath = localDatabasePath(config.databaseUrl);
  const folders = new Set([
    config.docsDir,
    config.dataDir,
    ...(databasePath ? [path.dirname(path.resolve(databasePath))] : [])
  ]);

  await Promise.all([...folders].map((folder) => fs.mkdir(folder, { recursive: true })));
}

async function ensureOllama(): Promise<void> {
  if (await checkOllama()) {
    logger.info("Ollama is reachable");
    return;
  }

  logger.info("Ollama not reachable; trying to start docker compose...");
  try {
    await runCommand("docker", ["compose", "up", "-d"]);
    for (let i = 0; i < 60; i += 1) {
      if (await checkOllama()) {
        logger.info("Ollama is reachable");
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch {
    // fall through to error
  }

  throw new Error(
    `Could not reach Ollama at ${config.ollamaBaseUrl}. ` +
    "Start it manually or run 'docker compose up -d'."
  );
}

async function main() {
  logger.info("ragship");
  logger.info(`Docs folder: ${config.docsDir}`);
  logger.info(`Database:    ${config.databaseUrl}`);
  logger.info(`Ollama:      ${config.ollamaBaseUrl}`);

  await ensureRuntimeFolders();
  await ensureOllama();
  await ensureModel(config.embeddingModel);
  await ensureModel(config.llmModel);

  const probe = await embedText("dimension probe");
  await initializeSchema(probe.length);

  logger.info("Ingesting documents...");
  await ingest();

  await server.listen({ host: config.serverHost, port: config.serverPort });
  logger.info(`Server ready at http://localhost:${config.serverPort}`);
}

main().catch((err) => {
  logger.error(err.message || String(err));
  process.exit(1);
});
