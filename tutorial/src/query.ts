#!/usr/bin/env node
/**
 * query.ts – simple CLI to perform similarity search against Qdrant.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {embedText, gemini, qdrant} from './config.ts';

const COLLECTION_NAME = 'pdf_chat_embeddings';

type RecipeName = 'r1' | 'r2';

type SearchHit = {
  id: string;
  score: number;
  vector: number[];
  payload: Record<string, any>;
  rerank?: number;
};

function cosineSim(a: Float32Array, b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const bv = typeof b[i] === 'number' ? b[i] : 0;
    dot += a[i] * bv;
    magA += a[i] * a[i];
    magB += bv * bv;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-9);
}

export interface SearchOptions {
  /** How many results to fetch per recipe from Qdrant */
  perRecipe?: number;
  /** Number of final passages to return */
  finalK?: number;
  /** Whether to apply LLM-based reranking. Defaults to false. */
  useLlmReranker?: boolean;
}

async function search(question: string, {
  perRecipe = 50,
  finalK = 20,
  useLlmReranker = true,
}: SearchOptions = {}) {
  const qVec = await embedText(question);
  const client = qdrant();

  const recipeResults: SearchHit[] = [];

  const recipes: RecipeName[] = ['r1', 'r2'];
  await Promise.all(
    recipes.map(async (r) => {
      const res: any = await client.search(COLLECTION_NAME, {
        vector: Array.from(qVec),
        limit: perRecipe,
        with_payload: true,
        with_vector: true,
        filter: { must: [{ key: 'recipe', match: { value: r } }] },
      });
      const items: SearchHit[] = (res.result ?? res ?? []).map((h: any) => ({
        id: h.id,
        score: h.score,
        vector: Array.isArray(h.vector) ? h.vector : Array.isArray(h.vector?.data) ? h.vector.data : [],
        payload: h.payload ?? {},
      }));
      recipeResults.push(...items);
    }),
  );

  // Deduplicate by text content (keep best score)
  const dedup = new Map<string, SearchHit>();
  for (const hit of recipeResults) {
    const key = hit.payload.text as string;
    if (!dedup.has(key) || dedup.get(key)!.score < hit.score) {
      dedup.set(key, hit);
    }
  }

  const merged = Array.from(dedup.values()).map((h) => ({
    ...h,
    rerank: cosineSim(qVec, h.vector),
  }));

  // preliminary sort by embedding similarity
  merged.sort((a, b) => b.rerank - a.rerank);

  if (!useLlmReranker) {
    return merged.slice(0, finalK);
  }

  // -----------------------------------------------------------------------
  // Optional LLM reranker (structured prompt to Gemini).
  // -----------------------------------------------------------------------

  const topForLlm = merged.slice(0, 50); // truncate context for prompt

  const model = 'gemini-2.5-flash-preview-04-17';
  const prompt = [
    'You are an information retrieval reranker.',
    'Given a user QUESTION and a list of CANDIDATE passages (id,text),',
    `select the ${finalK} passages that best answer the question.`,
    'Return ONLY a JSON array of objects, each with "id" and "score"',
    '(higher score means more relevant), ordered from most to least relevant.',
    'Example output: [{"id": "abc", "score": 0.93}, ...]',
  ].join('\\n');

  const candidatesText = topForLlm
    .map((p, idx) => `${idx + 1}. [${p.id}] ${String(p.payload.text).replace(/\n/g, ' ')}`)
    .join('\n');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llmResponse: any = await (gemini() as any).models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${prompt}\nQUESTION: ${question}\nCANDIDATES:\n${candidatesText}` },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  const chosen: { id: string; score: number }[] = [];
  try {
    const raw = llmResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item.id === 'string') {
          chosen.push({ id: item.id, score: Number(item.score) || 0 });
        }
      }
    }
  } catch {
    // Parsing failed – fall back to cosine ranking
  }

  if (chosen.length === finalK) {
    const scoreMap = new Map(chosen.map((c) => [c.id, c.score]));
    const reranked = merged.filter((h) => scoreMap.has(h.id));
    reranked.forEach((h) => { h.rerank = scoreMap.get(h.id)!; });
    reranked.sort((a, b) => (b.rerank ?? 0) - (a.rerank ?? 0));
    return reranked;
  }

  // fallback
  return merged.slice(0, finalK);
}

async function interactive(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log('Retrieving with both recipes (r1 & r2).');

  while (true) {
    const q = await rl.question('❓  ');
    if (!q) continue;

    const hits = await search(q);
    if (!hits.length) {
      console.log('⚠️   No matches');
      // eslint-disable-next-line no-continue
      continue;
    }
    console.log('\nTop results:');

    hits.forEach((h, index) => {
      const candidateNumber = index + 1;
      console.log('-'.repeat(60));
      console.log(`후보 ${candidateNumber}:`);
      console.log(h.payload.text.slice(0, 400).trim());
      console.log(`\n(recipe=${h.payload.recipe}), score=${(h.rerank ?? 0).toFixed(4)})\n`);
    });
  }
}

// If argument passed, one-off query; else REPL.
if (process.argv.length > 2) {
  const question = process.argv.slice(2).join(' ');
  search(question).then((hits) => {
    console.log(JSON.stringify(hits, null, 2));
  });
} else {
  interactive().catch(console.error);
}
