import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';
import { QdrantClient } from '@qdrant/js-client-rest';

/** Get required env variable or throw. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Google Gemini client singleton
// ---------------------------------------------------------------------------

let geminiSingleton: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  if (!geminiSingleton) {
    geminiSingleton = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  }
  return geminiSingleton;
}

// ---------------------------------------------------------------------------
// Qdrant client singleton
// ---------------------------------------------------------------------------

let qdrantSingleton: QdrantClient | undefined;

export function qdrant(): QdrantClient {
  if (!qdrantSingleton) {
    qdrantSingleton = new QdrantClient({
      url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    });
  }
  return qdrantSingleton;
}

// ---------------------------------------------------------------------------
// Embedding helper (with in-process cache)
// ---------------------------------------------------------------------------

const embedCache = new Map<string, Float32Array>();

export interface EmbedOptions {
  model?: string;
  taskType?: 'SEMANTIC_SIMILARITY' | string;
  outputDimensionality?: number;
}

export async function embedText(
  text: string,
  {
    model = 'gemini-embedding-exp-03-07',
    taskType = 'SEMANTIC_SIMILARITY',
    outputDimensionality = 768,
  }: EmbedOptions = {},
): Promise<Float32Array> {
  if (embedCache.has(text)) return embedCache.get(text)!;

  const embeddingModel = gemini().getGenerativeModel({ model });

  const res = await embeddingModel.embedContent({
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality,
  });

  const vector = Float32Array.from(res.embedding.values);
  embedCache.set(text, vector);
  return vector;
}
