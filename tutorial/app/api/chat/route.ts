// Streaming chat API using LlamaIndex + Qdrant + Gemini embeddings.

import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';

import { GoogleGenAI } from '@google/genai';

import { VectorStoreIndex } from 'llamaindex';
// BaseEmbedding is the minimal interface we must implement.
// eslint-disable-next-line import/no-extraneous-dependencies
import { BaseEmbedding } from '@llamaindex/core/embeddings';
// Qdrant adapter for LlamaIndex
// eslint-disable-next-line import/no-extraneous-dependencies
import { QdrantVectorStore } from '@llamaindex/qdrant';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const COLLECTION = 'pdf_chat_embeddings';
const DIM = 768;

const CACHE_DIR = path.resolve('.cache');
const INDEX_CACHE = path.join(CACHE_DIR, 'vector-index.json');

// ---------------------------------------------------------------------------
// Minimal embedding wrapper over Google GenAI embedContent
// ---------------------------------------------------------------------------

class GeminiEmbedding extends BaseEmbedding {
  private client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  async getTextEmbedding(text: string): Promise<number[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-any, @typescript-eslint/no-unsafe-assignment
    const res: any = await (this.client as any).models.embedContent({
      model: 'gemini-embedding-exp-03-07',
      contents: text,
      config: {
        taskType: 'SEMANTIC_SIMILARITY',
        outputDimensionality: DIM,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return res?.embeddings?.values ?? [];
  }
}

async function loadIndex(): Promise<VectorStoreIndex> {
  // Try warm cache first
  try {
    const s = await fs.stat(INDEX_CACHE);
    if (s.isFile()) return VectorStoreIndex.load(INDEX_CACHE);
  } catch {}

  const vectorStore = await QdrantVectorStore.fromEndpoint({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    collectionName: COLLECTION,
    vectorSize: DIM,
    distance: 'Cosine',
  });

  const embedModel = new GeminiEmbedding();

  const index = await VectorStoreIndex.fromVectorStore(vectorStore, {
    embedModel,
  });

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await index.save(INDEX_CACHE);
  } catch {}

  return index;
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { question } = (await req.json()) as { question: string };

  const index = await loadIndex();
  const engine = index.asQueryEngine({ similarityTopK: 4 });

  const stream = await engine.queryStream(question);

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
