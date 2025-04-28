# 📌 Project Progress & Next Steps

This document captures:

1. What has been accomplished so far.
2. The original goal / scope we are working towards.
3. The concrete TODO list from here on.

---

## 1. Work completed

| Area | Status | Notes |
|------|--------|-------|
| Environment / Tooling | ✅ Ready | TS strict `tsconfig`, ESLint-Airbnb, `ts-node` scripts |
| Gemini embedding helper | ✅ Implemented | `src/config.ts → embedText()` calls Gemini `embedContent`; dimensionality configurable |
| Singleton factories | ✅ Implemented | `gemini()` & `qdrant()` ensure single client instance |
| Hash util | ✅ Added | `src/hash.ts` (`sha256`) for deterministic chunk IDs |
| Ingestion CLI | ✅ Works | `src/ingest.ts` walks directory, parses PDFs, splits paragraphs, embeds & upserts to Qdrant |
| • Deduplication | ✅ Added | Point ID = SHA-256, skips existing chunks |
| Query CLI | ✅ Works | `src/query.ts` similarity search via Qdrant |
| Build | ✅ Clean | `npm run build` passes (no TS errors) |

---

## 2. Original MVP target

1. Backend RAG service  
   – Parse & chunk PDFs → Gemini embeddings → Qdrant  
   – Serve answers through LlamaIndex `QueryEngine` (SSE streaming)

2. Front-end  
   – Next.js (App Router) page `/chat`  
   – Vercel AI SDK `useChat` + shadcn/ui chat bubbles

---

## 3. TODO Roadmap

### A · Backend API (Next.js)
1. `app/api/chat/route.ts` – load `VectorStoreIndex` from Qdrant, `queryStream()` → SSE.  
2. Index serialisation cache: `index.save()` after ingest, `VectorStoreIndex.load()` on cold start.  
3. Store page / section metadata in payload & surface citations.

### B · Frontend UI
1. Implement `/chat/page.tsx` with `useChat` stream rendering.  
2. Add shadcn/ui components (bubbles, loader, scroll area).  
3. File upload route `/api/upload` + progress indicator.

### C · Ingestion improvements
2. Incremental ingest (hash diff) & embed cache on disk (`./cache/embeds`).

### D · Ops & Quality
1. Docker compose (Next.js + Qdrant).  
2. Pre-commit hook running ESLint.  
3. Basic CI: type-check + lint + sample ingest/search.

---

## 4. Handy commands

```bash
# Build & type-check
pnpm --filter tutorial run build

# Ingest documents (defaults to ./data)
pnpm --filter tutorial run ingest ./data


# CLI query
pnpm --filter tutorial run query "What is covered in chapter 2?"
```

Happy hacking 🚀
