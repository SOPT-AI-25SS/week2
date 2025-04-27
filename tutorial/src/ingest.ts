#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
/**
 * ingest.ts – walk a directory, read .txt/.md/.pdf files, embed each paragraph
 * with Gemini, and upsert into Qdrant.
 */

import fs from 'node:fs/promises';
import path, { extname, join } from 'node:path';

import { embedText, qdrant } from './config.js';

const COLLECTION_NAME = 'pdf_chat_embeddings';
const VECTOR_SIZE = 768;

// -------------------------------------------------------------------------
// Simple recursive file discovery
// -------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      files.push(...(await walk(p)));
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (['.txt', '.md', '.markdown', '.pdf'].includes(ext)) files.push(p);
    }
  }
  return files;
}

// -------------------------------------------------------------------------
// Ensure Qdrant collection exists
// -------------------------------------------------------------------------

async function ensureCollection(): Promise<void> {
  const client = qdrant();
  const collections = await client.getCollections();
  const exists = collections.collections?.some((c) => c.name === COLLECTION_NAME);
  if (!exists) {
    // create
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
  }
}

// -------------------------------------------------------------------------
// PDF text extractor using pdfjs-lib (lazy loaded)
// -------------------------------------------------------------------------

let pdfjs: typeof import('pdfjs-lib') | undefined;

async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-lib');
  return pdfjs!;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfModule = await loadPdfjs();
  const doc = await pdfModule.getDocument({ data: buffer }).promise;
  let text = '';
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    text += `${content.items.map((i: any) => i.str).join(' ')}\n\n`;
  }
  return text;
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? path.resolve('data');
  console.log(`📄  ingesting from ${rootDir}`);

  const paths = await walk(rootDir);
  if (!paths.length) throw new Error('No ingestible files found.');

  await ensureCollection();
  const client = qdrant();

  let processed = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const p of paths) {
    const ext = extname(p).toLowerCase();
    let fileText: string;
    if (ext === '.pdf') {
      const buf = await fs.readFile(p);
      fileText = await extractPdfText(buf);
    } else {
      fileText = await fs.readFile(p, 'utf8');
    }

    const paragraphs = fileText.split(/\n{2,}/g).filter(Boolean);
    // eslint-disable-next-line no-restricted-syntax
    for (const para of paragraphs) {
      const vector = await embedText(para);
      await client.upsert(COLLECTION_NAME, {
        wait: false,
        points: [
          {
            id: `${p}_${processed}`,
            vector: Array.from(vector),
            payload: {
              text: para,
              file: p,
            },
          },
        ],
      });
      processed += 1;
      if (processed % 20 === 0) console.log(`…${processed}`);
    }
  }

  console.log(`✅  upserted ${processed} chunks.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
