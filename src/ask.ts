import { config } from "./config.js";
import { searchSimilarChunks } from "./db.js";
import { embedText, generateAnswer } from "./ollama.js";
import type { RagAnswer, SimilarChunk } from "./types.js";

function compactContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trim()}\n[contenuto troncato]`;
}

function buildContext(chunks: SimilarChunk[]): string {
  const perChunkLimit = Math.max(900, Math.floor(6500 / Math.max(1, chunks.length)));
  return chunks
    .map(
      (chunk, index) => `[Fonte ${index + 1}]
Titolo: ${chunk.title}
Sezione: ${chunk.section ?? ""}
File: ${chunk.relativePath}
Contenuto:
${compactContent(chunk.content, perChunkLimit)}`
    )
    .join("\n\n");
}

function buildPrompt(question: string, chunks: SimilarChunk[]): string {
  return `Sei un assistente tecnico. Rispondi alla domanda usando ESCLUSIVAMENTE il contesto fornito.

Istruzioni:
- Analizza la domanda, cerca le informazioni rilevanti nel contesto e rispondi in modo chiaro e strutturato.
- Se le informazioni sono insufficienti o assenti, rispondi esattamente: "Non risulta nei documenti indicizzati."
- Se le informazioni sono ambigue o contrastanti, segnalalo esplicitamente.
- Rispondi nella stessa lingua della domanda.
- Cita ogni affermazione con titolo documento e sezione tra parentesi.
- Non inventare server, path, comandi, credenziali, procedure o nomi.
- Non usare conoscenza esterna.

Domanda:
${question}

Contesto:
${buildContext(chunks)}

Risposta:`;
}

export async function ask(question: string): Promise<RagAnswer> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    throw new Error("Question is required");
  }

  const questionEmbedding = await embedText(trimmedQuestion);
  const chunks = await searchSimilarChunks(questionEmbedding, config.ragTopK);
  const prompt = buildPrompt(trimmedQuestion, chunks.slice(0, 5));
  const answer = chunks.length > 0 ? await generateAnswer(prompt) : "Non risulta nei documenti indicizzati.";

  return {
    answer,
    sources: chunks.map((chunk) => ({
      title: chunk.title,
      section: chunk.section,
      relativePath: chunk.relativePath,
      score: chunk.score
    })),
    chunks
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const question = process.argv.slice(2).join(" ");
  const result = await ask(question);
  console.log(result.answer);
  console.log("\nFonti:");
  for (const source of result.sources) {
    console.log(`- ${source.title}${source.section ? ` / ${source.section}` : ""} (${source.relativePath}) score=${source.score.toFixed(3)}`);
  }
}
