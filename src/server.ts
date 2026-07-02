import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { ask } from "./ask.js";
import { config } from "./config.js";
import { checkDb } from "./db.js";
import { checkOllama } from "./ollama.js";

const server = Fastify({ logger: false });

server.get("/", async (_request, reply) => {
  const html = await readFile(new URL("./landing.html", import.meta.url), "utf8");
  return reply.type("text/html").send(html);
});

server.get("/app", async (_request, reply) => {
  const html = await readFile(new URL("./ui.html", import.meta.url), "utf8");
  return reply.type("text/html").send(html);
});

server.get("/health", async () => {
  const [database, ollama] = await Promise.all([checkDb(), checkOllama()]);
  return {
    ok: database && ollama,
    database,
    ollama
  };
});

server.post<{ Body: { question?: string } }>("/ask", async (request, reply) => {
  const question = request.body?.question?.trim();
  if (!question) {
    return reply.code(400).send({ error: "question is required" });
  }

  const result = await ask(question);
  return {
    answer: result.answer,
    sources: result.sources
  };
});

if (import.meta.url === `file://${process.argv[1]}`) {
  await server.listen({ host: config.serverHost, port: config.serverPort });
}

export { server };
