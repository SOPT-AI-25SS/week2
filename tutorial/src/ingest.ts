#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
/**
 * ingest.ts – walk a directory, read .txt/.md/.pdf files, embed each paragraph
 * with Gemini, and upsert into Qdrant.
 */
import fs from 'node:fs/promises';
import path, { extname, join } from 'node:path';

// -------------------------------------------------------------------------
// Text splitting (LangChain RecursiveCharacterTextSplitter)
// -------------------------------------------------------------------------

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { embedText, qdrant } from './config.ts';
import { v5 as uuidv5 } from 'uuid';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Simple promise-based sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const COLLECTION_NAME = 'pdf_chat_embeddings';
const VECTOR_SIZE = 3072;

// -------------------------------------------------------------------------
// Simple recursive file discovery
// -------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
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

// Switch to pdfjs-dist (latest) legacy build – provides getDocument API.
type PdfJs = { getDocument: (arg: any) => any };

let pdfjsModule: PdfJs | undefined;

async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsModule) {
    // pdfjs-dist v4 ships ESM bundles as .mjs (no .js). Use dynamic import so
    // it works regardless of exact file extension present in installed
    // version.  Try legacy build first (includes CMaps), fallback to regular
    // build.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let mod: any;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore – path checked at runtime
      mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mod = await import('pdfjs-dist/build/pdf.mjs');
    }
    pdfjsModule = (mod.getDocument ? mod : mod.default) as PdfJs;
  }
  return pdfjsModule;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocument } = await loadPdfjs();
  // pdfjs-dist requires Uint8Array, not Node.js Buffer.
  const uint8array = new Uint8Array(buffer);
  const doc = await getDocument({ data: uint8array }).promise;
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

  // -----------------------------------------------------------------------
  // Define multiple text-splitting "recipes" so that we can experiment with
  // retrieval granularity at query-time.
  // -----------------------------------------------------------------------

  const RECIPES = [
    { name: 'r1', chunkSize: 1000, chunkOverlap: 200 },
    { name: 'r2', chunkSize: 2048, chunkOverlap: 400 },
  ] as const;

  // Pre-create a splitter per recipe (these are lightweight objects).
  const splitters = Object.fromEntries(
    RECIPES.map((r) => [r.name, new RecursiveCharacterTextSplitter({
      chunkSize: r.chunkSize,
      chunkOverlap: r.chunkOverlap,
    })]),
  ) as Record<string, RecursiveCharacterTextSplitter>;

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

    // Process each recipe separately so we can store multiple granularities.
    for (const recipe of RECIPES) {
      const splitter = splitters[recipe.name];
      const chunks = await splitter.splitText(fileText);

      // eslint-disable-next-line no-restricted-syntax
      for (const chunk of chunks) {
        const vector = await embedText(chunk);

        // Respect Gemini rate-limits – pause briefly after each embedding call.
        await sleep(1000);

        // Qdrant point IDs must be either an unsigned integer or a UUID.
        // Deterministic UUID so re-ingesting is idempotent.
        const pointId = uuidv5(`${recipe.name}:${p}:${chunk}`, uuidv5.URL);

        await client.upsert(COLLECTION_NAME, {
          wait: false,
          points: [
            {
              id: pointId,
              vector: Array.from(vector),
              payload: {
                text: chunk,
                file: p,
                recipe: recipe.name,
                chunk_size: recipe.chunkSize,
                chunk_overlap: recipe.chunkOverlap,
                char_count: chunk.length,
              },
            },
          ],
        });

        processed += 1;
        console.log(`Processed ${processed} chunks (recipe=${recipe.name})`);
      }
    }
  }

  console.log(`✅  upserted ${processed} chunks.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
