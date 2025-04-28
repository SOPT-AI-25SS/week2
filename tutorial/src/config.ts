import 'dotenv/config';

import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { GoogleGenAI } from '@google/genai';
import { QdrantClient } from '@qdrant/js-client-rest';

import { sha256 } from './hash.ts';

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
      checkCompatibility: false,
    });
  }
  return qdrantSingleton;
}

// ---------------------------------------------------------------------------
// Embedding helper (with in-process cache)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Persistent embedding cache (disk-backed JSONL)
// ---------------------------------------------------------------------------

const embedCache = new Map<string, Float32Array>();

const CACHE_DIR = path.resolve('.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'embed-cache.jsonl');

let diskCacheInitialized = false;

function ensureDiskCacheLoaded() {
  if (diskCacheInitialized) return;
  diskCacheInitialized = true;

  if (!existsSync(CACHE_FILE)) return;

  try {
    // Read file and parse JSONL.
    const data = readFileSync(CACHE_FILE, 'utf8').trim();
    if (!data) return;
    const lines = data.split(/\n+/);
    for (const line of lines) {
      if (!line) continue;
      const { k, v } = JSON.parse(line);
      if (typeof k === 'string' && Array.isArray(v)) {
        embedCache.set(k, Float32Array.from(v));
      }
    }
  } catch {
    // ignore read errors (file may be concurrently written or corrupted)
  }
}

function persistEmbedding(key: string, vector: Float32Array) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const record = JSON.stringify({ k: key, v: Array.from(vector) });
    appendFileSync(CACHE_FILE, `${record}\n`);
  } catch {
    // best-effort – ignore write errors
  }
}

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
  // Determine cache key (sha256 of raw text) – avoids huge Map keys.
  const key = sha256(text);

  ensureDiskCacheLoaded();

  if (embedCache.has(key)) return embedCache.get(key)!;

  // The official @google/genai SDK (v0.10+) exposes the text-embedding endpoint
  // via `ai.models.embedContent(...)`.
  // See: https://ai.google.dev/gemini-api/docs/get-text-embeddings

  const res = await gemini().models.embedContent({
    model,
    contents: text,
    config: {
      taskType,
      outputDimensionality,
    },
  });

  const vector = Float32Array.from(res.embeddings?.[0]?.values ?? []);
  embedCache.set(key, vector);

  // Persist for next runs (fire-and-forget).
  persistEmbedding(key, vector);
  return vector;
}
