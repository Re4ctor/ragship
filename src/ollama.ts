import { config } from "./config.js";
import { logger } from "./utils/logger.js";

class TinyCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize = 100) {}
  get(key: K): V | undefined {
    return this.cache.get(key);
  }
  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value as K;
      this.cache.delete(first);
    }
    this.cache.set(key, value);
  }
}

const embeddingCache = new TinyCache<string, number[]>(200);
const answerCache = new TinyCache<string, string>(20);

type EmbeddingResponse = {
  embedding?: number[];
};

type GenerateResponse = {
  response?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.ollamaRetries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= config.ollamaRetries) break;
      await sleep(config.ollamaRetryBaseMs * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

let embeddingQueue: Promise<unknown> = Promise.resolve();

export async function embedText(prompt: string): Promise<number[]> {
  const cached = embeddingCache.get(prompt);
  if (cached) return cached;

  const request = async () => {
    const data = await fetchWithRetry<EmbeddingResponse>(`${config.ollamaBaseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.embeddingModel,
        prompt
      })
    });

    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error("Ollama returned an empty embedding");
    }

    embeddingCache.set(prompt, data.embedding);
    return data.embedding;
  };

  if (config.embeddingConcurrency > 1) {
    return request();
  }

  const next = embeddingQueue.then(request, request);
  embeddingQueue = next.catch(() => undefined);
  return next;
}

export async function generateAnswer(prompt: string): Promise<string> {
  const cached = answerCache.get(prompt);
  if (cached) return cached;

  const data = await fetchWithRetry<GenerateResponse>(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llmModel,
      prompt,
      stream: false,
      options: {
        temperature: config.ollamaTemperature,
        top_p: 0.8,
        num_ctx: config.ollamaNumCtx,
        num_predict: 1024
      }
    })
  });

  const answer = data.response?.trim() || "";
  answerCache.set(prompt, answer);
  return answer;
}

export async function checkOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

type TagsResponse = {
  models?: Array<{ name: string }>;
};

function modelIsPresent(tags: TagsResponse, model: string): boolean {
  const normalized = model.includes(":") ? model : `${model}:latest`;
  return tags.models?.some((m) => m.name === model || m.name === normalized) ?? false;
}

export async function ensureModel(model: string): Promise<void> {
  const tags = await fetchWithRetry<TagsResponse>(`${config.ollamaBaseUrl}/api/tags`, { method: "GET" });
  if (modelIsPresent(tags, model)) {
    logger.info(`Model ${model} is ready`);
    return;
  }

  logger.info(`Pulling model ${model}...`);
  const response = await fetch(`${config.ollamaBaseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to pull ${model}: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lastStatus = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.status && data.status !== lastStatus) {
          lastStatus = data.status;
          logger.info(`[pull ${model}] ${data.status}`);
        }
      } catch {
        // ignore malformed stream lines
      }
    }
  }
}
