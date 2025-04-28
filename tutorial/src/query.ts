#!/usr/bin/env node
/**
 * query.ts – simple CLI to perform similarity search against Qdrant.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { embedText, qdrant } from './config.ts';

const COLLECTION_NAME = 'pdf_chat_embeddings';

async function search(question: string) {
  const vec = await embedText(question);
  const client = qdrant();
  const res: any = await client.search(COLLECTION_NAME, {
    vector: Array.from(vec),
    limit: 5,
    with_payload: true,
  });
  return res.result ?? res ?? [];
}

async function interactive(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const q = await rl.question('❓  ');
    if (!q) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const hits = await search(q);
    if (!hits.length) {
      console.log('⚠️   No matches');
      // eslint-disable-next-line no-continue
      continue;
    }
    console.log('\nTop results:');
    for (const h of hits) {
      console.log('-'.repeat(60));
      console.log((h.payload as any).text?.slice(0, 400).trim());
      console.log(`\n(score=${h.score.toFixed(4)})\n`);
    }
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
