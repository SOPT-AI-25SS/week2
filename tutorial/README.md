# Start
```
https://aistudio.google.com/ 에 들어가서 API Key를 발급받습니다
docker 설치 하고,  docker run -p 6333:6333 qdrant/qdrant 해주세요.

npm install
npm install llamaindex
npm install ai
```

# Architecture
```
┌─────────────┐   PDF 업로드   ┌──────────────────┐   HTTP(S)/SSE   ┌────────────┐
│ React  UI   │──────────────▶│  Next.js API      │───────────────▶│ LlamaIndex │
│ (useChat)   │  질의/스트림   │  (edge/server)    │  context +     │  QueryEngine│
└─────────────┘◀──────────────└──────────┬─────────┘  답변 스트림    └─────┬──────┘
        ▲        websocket / SSE              │                        DB  │
        │                                     │ embed + upsert            │
        │                             ┌───────▼────────┐                 │
        │                             │ Gemini Embed   │                 │
        │                             └────┬───────────┘                 │
        │                                  │                             │
        │                                  ▼                             ▼
        │                         ┌────────────────┐           ┌────────────────┐
        │                         │  Qdrant Vector │◀──────────┤   Postgres │
        │                         └────────────────┘   payload └────────────────┘
```


한 눈에 보기 – PDF → 벡터 인덱스 → 질의응답 → ChatGPT-스타일 프런트엔드까지를 한 프로젝트로 엮는 전체 플로를 제시합니다.
백엔드는 LlamaParse + LlamaIndex.TS로 PDF를 파싱·청킹하고, Google Gemini Embedding API로 한국어 친화적 3 072-차원(또는 축소) 벡터를 만들고 Qdrant에 저장합니다.
프런트엔드는 Next.js (App Router)와 Vercel AI SDK의 useChat 훅을 써서 ChatGPT 같은 스트리밍 UI를 제공하며, shadcn/ui 컴포넌트로 대화 버블을 꾸밉니다.
아래를 그대로 따라 하면 로컬 Docker Qdrant + Next.js dev 서버에서 작동하는 MVP를 30 분 안에 띄울 수 있습니다.

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 1 . 아키텍처 개요

    ┌─────────────┐   PDF 업로드   ┌──────────────────┐   HTTP(S)/SSE   ┌────────────┐
    │ React  UI   │──────────────▶│  Next.js API      │───────────────▶│ LlamaIndex │
    │ (useChat)   │  질의/스트림   │  (edge/server)    │  context +     │  QueryEngine│
    └─────────────┘◀──────────────└──────────┬─────────┘  답변 스트림    └─────┬──────┘
            ▲        websocket / SSE              │                        DB  │
            │                                     │ embed + upsert            │
            │                             ┌───────▼────────┐                 │
            │                             │ Gemini Embed   │                 │
            │                             └────┬───────────┘                 │
            │                                  │                             │
            │                                  ▼                             ▼
            │                         ┌────────────────┐           ┌────────────────┐
            │                         │  Qdrant Vector │◀──────────┤   Postgres/TBD │
            │                         └────────────────┘   payload └────────────────┘

    * **PDF 파싱** – `SimpleDirectoryReader`가 기본 PDF 로더를 자동 선택하지만, 레이아웃 보존이 필요하면 `LlamaParse`로 교체 가능  ([SimpleDirectoryReader -
LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/loading/simpledirectoryreader/?utm_source=chatgpt.com), [LlamaParse -
LlamaIndex](https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/?utm_source=chatgpt.com))
* **임베딩** – `gemini-embedding-exp-03-07`은 3 072-차원 기본 출력과 `outputDimensionality` 축소 옵션을 지원  ([Embeddings | Gemini API | Google AI for
Developers](https://ai.google.dev/gemini-api/docs/embeddings?utm_source=chatgpt.com), [Get text embeddings | Generative AI on Vertex AI - Google
Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings?utm_source=chatgpt.com))
* **벡터 DB** – Qdrant REST SDK는 TypeScript 타입을 제공하며 `size`·`distance`만 지정하면 컬렉션 생성  ([qdrant/js-client-rest - NPM](https://www.npmjs.com/package/%40qdrant/js-client-rest?utm_source=chatgpt.com), [API &
SDKs - Qdrant](https://qdrant.tech/documentation/interfaces/?utm_source=chatgpt.com))
* **UI** – Vercel AI SDK의 `useChat` 훅이 스트리밍 메시지 상태를 관리하고, shadcn/ui 채팅 컴포넌트를 쉽게 붙일 수 있음  ([useChat - AI SDK UI](https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat?utm_source=chatgpt.com),
[AI SDK by Vercel](https://sdk.vercel.ai/docs/introduction?utm_source=chatgpt.com))

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 2 . 프로젝트 초기화

    pnpm create next-app@latest pdf-chat --ts --app-router
    cd pdf-chat
    pnpm i llamaindex @llamaindex/openai @llamaindex/llamaparse \
           @google/genai @qdrant/js-client-rest \
           @ai-sdk/react @ai-sdk/vercel \
           shadcn-ui react-markdown dotenv

    Docker Qdrant docker run -p 6333:6333 qdrant/qdrant 로 즉시 실행  (Local Quickstart - Qdrant (https://qdrant.tech/documentation/quickstart/?utm_source=chatgpt.com))  

.env:

    GEMINI_API_KEY=...
    QDRANT_URL=http://localhost:6333

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 3 . 백엔드 – API Route (app/api/chat/route.ts)

    import { NextResponse } from "next/server";
    import { GoogleGenAI } from "@google/genai";
    import { QdrantClient } from "@qdrant/js-client-rest";
    import { SimpleDirectoryReader, VectorStoreIndex } from "llamaindex";

    const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });

    export async function POST(req: Request) {
      const { question } = await req.json();

      // 1) 파싱·인덱스 (메모리에 없다면 캐시 or KV에 저장 권장)
      const docs = await new SimpleDirectoryReader().loadData("./data"); // PDF 폴더
      const index = await VectorStoreIndex.fromDocuments(docs, {
        embedModel: gemini.embeddings({
          model: "gemini-embedding-exp-03-07",
          taskType: "SEMANTIC_SIMILARITY",
          outputDimensionality: 768,
        }),
        vectorStore: qdrant,               // 직접 주입 가능 (LlamaIndex 0.11+)
      });

      // 2) 질의
      const engine = index.asQueryEngine({ similarityTopK: 4 });
      const stream = await engine.queryStream(question);

      // 3) 스트림을 그대로 반환 (Vercel AI SDK 형식)
      return new NextResponse(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    * `outputDimensionality`로 768-차원에 맞춰 Qdrant 컬렉션 `size: 768` 을 설정  ([Embeddings | Gemini API | Google AI for Developers](https://ai.google.dev/api/embeddings?utm_source=chatgpt.com), [qdrant/js-client-rest -
NPM](https://www.npmjs.com/package/%40qdrant/js-client-rest?utm_source=chatgpt.com))
* `queryStream`은 SSE로 chunk를 보내 UI에서 실시간 렌더 가능  ([Qdrant - LangChain.js](https://js.langchain.com/docs/integrations/retrievers/self_query/qdrant/?utm_source=chatgpt.com))

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 4 . 프런트엔드 – Chat 컴포넌트 (app/chat/page.tsx)

    "use client";
    import { useChat } from "@ai-sdk/react";
    import { Button, Input, ScrollArea } from "@/components/ui"; // shadcn/ui

    export default function Chat() {
      const { messages, input, handleInputChange, handleSubmit, isLoading } =
        useChat({ api: "/api/chat" });

      return (
        <div className="max-w-2xl mx-auto p-4">
          <ScrollArea className="h-[70vh] border rounded-xl p-4 space-y-3">
            {messages.map(m => (
              <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
                <div
                  className={`rounded-xl p-3 ${
                    m.role === "user" ? "bg-slate-200" : "bg-emerald-50"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </ScrollArea>

          <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
            <Input
              value={input}
              onChange={handleInputChange}
              placeholder="PDF에 대해 질문해 보세요…"
            />
            <Button disabled={isLoading}>보내기</Button>
          </form>
        </div>
      );
    }

    * `useChat`은 메시지 스트림을 자동으로 수신·append  ([Chatbot - AI SDK UI](https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot?utm_source=chatgpt.com), [Call Tools - Next.js - AI
SDK](https://sdk.vercel.ai/cookbook/next/call-tools?utm_source=chatgpt.com))
* shadcn/ui 컴포넌트들은 Tailwind 기반으로 빠른 커스터마이징이 가능  ([A curated list of awesome things related to shadcn/ui. - GitHub](https://github.com/birobirobiro/awesome-shadcn-ui?utm_source=chatgpt.com))

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 5 . PDF 업로드 & 재인덱싱 (선택)

    1. UI에 `file` input을 두고 `/api/upload` API Route에 `FormData`로 전송.
    2. 서버에서 `fs.writeFile`로 `./data/`에 저장한 뒤, 위 `SimpleDirectoryReader` 파이프라인을 다시 실행해 인덱스를 갱신.
    3. 대용량 처리 시 ingestion 파이프라인을 별도 워커(Edge Cron)로 분리 권장  ([Loading Data (Ingestion) - LlamaIndex](https://docs.llamaindex.ai/en/stable/understanding/loading/loading/?utm_source=chatgpt.com), [Parsing PDFs
with LlamaParse: a how-to guide - LlamaIndex](https://www.llamaindex.ai/blog/pdf-parsing-llamaparse?utm_source=chatgpt.com))

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 6 . 배포 & 스케일 전략

┌──────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 요소         │ 로컬 → 프로드                                                                                                                          │
├──────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Qdrant       │ Docker → Qdrant Cloud (TLS + API Key)  (Security - Qdrant (https://qdrant.tech/documentation/guides/security/?utm_source=chatgpt.com)) │
├──────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ LLM Provider │ Gemini API (8 K 토큰) → Vertex AI 멀티리전 엔드포인트  ([Embeddings                                                                    │
├──────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Next.js      │ Vercel Hobby → Pro 플랜 (Edge Runtime + Image opt.)                                                                                    │
├──────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 환경 변수    │ Vercel Project → Team Secrets                                                                                                          │
└──────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 7 . 품질 향상 Tips

    * **메타데이터 Payload**: 페이지 번호·섹션 ID를 `payload`에 저장하고, 답변에 참고 페이지 표기  ([Qdrant | API Reference](https://api.qdrant.tech/?utm_source=chatgpt.com))
    * **하이브리드 검색**: Qdrant `score_threshold + text` 필터로 키워드 점수를 혼합하면 숫자·코드 검색이 향상  ([Explore - Qdrant](https://qdrant.tech/documentation/concepts/explore/?utm_source=chatgpt.com))
    * **한국어 프롬프트 템플릿**: 대학생 대상– “핵심 요약 → 개념 풀이 → 실용 예시” 구조 권장  ([Loading Data - LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/loading/?utm_source=chatgpt.com))
    * **임베딩 교체**: 저장·추론 지연이 문제라면 VoyagerAI 768-차원 모델로 교체 가능  ([Generalizable Embeddings from Gemini - arXiv](https://arxiv.org/html/2503.07891v1?utm_source=chatgpt.com))
    * **모니터링**: Next.js 13+의 Server Actions에서 로그를 DB(Storage)로 적재, 프롬프트 실패율을 대시보드화  ([AI SDK 4.2 - Vercel](https://vercel.com/blog/ai-sdk-4-2?utm_source=chatgpt.com))

----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

### 참고한 문서·가이드

    1. LlamaIndex SimpleDirectoryReader  ([SimpleDirectoryReader - LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/loading/simpledirectoryreader/?utm_source=chatgpt.com))
    2. LlamaIndex Loading Data guide  ([Loading Data - LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/loading/?utm_source=chatgpt.com))
    3. LlamaParse TS 문서  ([LlamaParse - LlamaIndex](https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/?utm_source=chatgpt.com))
    4. Gemini Embeddings API 개요  ([Embeddings | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/embeddings?utm_source=chatgpt.com))
    5. OutputDimensionality 파라미터  ([Get text embeddings | Generative AI on Vertex AI - Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings?utm_source=chatgpt.com))
    6. Qdrant JS REST SDK NPM  ([qdrant/js-client-rest - NPM](https://www.npmjs.com/package/%40qdrant/js-client-rest?utm_source=chatgpt.com))
    7. Qdrant REST Docs  ([API & SDKs - Qdrant](https://qdrant.tech/documentation/interfaces/?utm_source=chatgpt.com))
    8. Vercel AI SDK `useChat` 훅  ([useChat - AI SDK UI](https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat?utm_source=chatgpt.com))
    9. AI SDK Intro  ([AI SDK by Vercel](https://sdk.vercel.ai/docs/introduction?utm_source=chatgpt.com))
    10. AI SDK Chatbot Guide  ([Chatbot - AI SDK UI](https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot?utm_source=chatgpt.com))
    11. Vercel Next.js AI Chatbot 템플릿  ([Next.js AI Chatbot - Vercel](https://vercel.com/templates/next.js/nextjs-ai-chatbot?utm_source=chatgpt.com))
    12. Shadcn/ui 컴포넌트 정리  ([A curated list of awesome things related to shadcn/ui. - GitHub](https://github.com/birobirobiro/awesome-shadcn-ui?utm_source=chatgpt.com))
    13. Qdrant 필터·Explore API  ([Explore - Qdrant](https://qdrant.tech/documentation/concepts/explore/?utm_source=chatgpt.com))
    14. Qdrant Security (API Key)  ([Security - Qdrant](https://qdrant.tech/documentation/guides/security/?utm_source=chatgpt.com))
    15. LlamaIndex Loading Best Practices  ([Loading Data (Ingestion) - LlamaIndex](https://docs.llamaindex.ai/en/stable/understanding/loading/loading/?utm_source=chatgpt.com))

이대로 복붙-실행하면서 궁금한 점이 생기면 언제든 물어보세요!

    thinking for 14s

    codex
    와 — 입력해 주신 플로우만 따라도 대부분의 팀이 “PDF-RAG 챗봇” MVP를 바로 띄울 수 있겠네요!
    실제 구축 과정에서 자주 마주치는 시행착오와 성능-보완 포인트를 몇 가지만 덧붙여 드립니다.

    ──────────────────
    핵심 체크-리스트
    ──────────────────

        1. LlamaIndex.TS × Gemini 임베딩 호환
           • LlamaIndex(TS) v0.9+에 기본 제공되는 `GoogleGenerativeAIEmbedding` 클래스를 써야 `embedModel` 타입이 맞습니다.

               import { GoogleGenerativeAIEmbedding } from "llamaindex";

               const embedModel = new GoogleGenerativeAIEmbedding({
                 apiKey: process.env.GEMINI_API_KEY!,
                 model: "gemini-embedding-exp-03-07",
                 taskType: "SEMANTIC_SIMILARITY",
                 outputDimensionality: 768,
               });

           • `gemini.embeddings()` 객체를 그대로 넘기면 타입 불일치로 컴파일 에러가 나므로 위처럼 래퍼 클래스를 사용하세요.
        2. Qdrant ­vectorStore 주입
           • LlamaIndex.TS에 내장된 `QdrantVectorStore`를 이용하면 컬렉션-생성 로직, point-upsert 등이 자동화됩니다.

               import { QdrantVectorStore } from "llamaindex";

               const vectorStore = await QdrantVectorStore.fromClient({
                 client: new QdrantClient({ url: process.env.QDRANT_URL! }),
                 collectionName: "pdf-chat-embeddings",
                 vectorSize: 768,
                 distance: "Cosine",
               });

           • 이렇게 만든 `vectorStore`를 `VectorStoreIndex.fromDocuments`에 넘기면 됩니다.
        3. “요청마다 인덱싱” → 배치 / 캐싱 권장
           • PDF 수가 조금만 늘어나도 `SimpleDirectoryReader` → `VectorStoreIndex.fromDocuments` 단계가 수 초~수 분 걸립니다.
           • API 라우트가 아닌 `scripts/ingest.ts` 같은 별도 스크립트나 CRON-Worker에서 인덱싱 후 디스크·KV·S3 등에 직렬화-저장(`index.save()`) 하고,
             요청 시엔 `VectorStoreIndex.load()` 로 불러오면 **cold-start ≒ 0.3 s** 정도까지 줄어듭니다.
        4. Streaming 설정 (Next.js App Router)
           • `return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream" } });` 만으로는
             Vercel Edge Network에서 자동 버퍼링이 걸려 chunk가 몰아서 전달되는 경우가 있습니다.
           • `export const dynamic = "force-dynamic";` 또는 Route-handler 상단에

               import { experimental_streamAsyncIterable } from "ai";

             같이 명시해 주면 안정적으로 실시간 SSE가 흘러갑니다.
        5. PDF-파싱 정확도
           • 단순 텍스트가 깨지거나 표·수식 레이아웃이 중요한 문서라면 `new LlamaParse({ resultType: "markdown" })` 로 교체하세요.
           • 청킹(Chunk size / overlap)도 한국어 문장 길이에 맞춰 1 000 ~ 1 500 토큰, overlap ≈ 200 정도가 경험상 가장 자연스럽습니다.
        6. 대용량 업로드 시 처리 순서
           ① `/api/upload` 에서 파일 저장 → ② 메시지큐(Resend Webhook · Cloud Tasks 등)에 “ingest job” 발행 →
           ③ 백그라운드 Worker 가 인덱싱 후 Qdrant upsert → ④ 완료 후 UI 알림.
           이 패턴이 UX-Block 없이 가장 깔끔합니다.
        7. 보안 & 비용
           • Gemini Embedding 호출 비용이 생각보다 높습니다(1000토큰 ≒ 0.0001$). 학습용 PDF 수백 개면 한번에 몇 $ 나갈 수 있으므로
             “인덱스를 재생성하기 전 diff 체크 → 변경분만 임베딩” 로직을 넣는 것이 좋습니다.
           • Qdrant Cloud를 쓸 경우 `Collections` 권한 분리(RO Query Key)만 해도 실수로 삭제되는 사고를 상당히 줄일 수 있습니다.

    ──────────────────
    샘플 파일 트리 (최소 구성)
    ──────────────────

        pdf-chat/
        ├─ app/
        │  ├─ api/
        │  │  └─ chat/route.ts
        │  ├─ chat/page.tsx
        │  └─ layout.tsx
        ├─ scripts/
        │  └─ ingest.ts            # CLI 인덱싱 스크립트
        ├─ data/                   # PDF 보관 폴더
        ├─ .env.local
        └─ package.json

    ──────────────────
    마지막으로…
    ──────────────────
    • 위 수정 사항만 반영하면 “로컬 Docker Qdrant + Next.js dev 서버” 기준 5 분 안에 첫 질문-답변이 흐르는 걸 확인하실 수 있을 거예요.
    • 구현 중 특정 에러 스택이나 퍼포먼스 병목이 보이면 로그 그대로 가져와서 문의 주세요. 필요한 부분만 디버깅-패치까지 도와드리겠습니다!

    행복한 코딩 되세요 🚀


    Below you’ll find:

        1. The **original technical spec** you provided (untouched, for easy reference).
        2. A **summary of the work that has just been applied** to the repo.
        3. A **TODO list / next steps** to finish the end-to-end PDF-RAG product.

    ────────────────────────────────────────

        1. Original Technical Spec
           ────────────────────────────────────────

        ┌─────────────┐   PDF 업로드   ┌──────────────────┐   HTTP(S)/SSE   ┌────────────┐
        │ React  UI   │──────────────▶│  Next.js API      │───────────────▶│ LlamaIndex │
        │ (useChat)   │  질의/스트림   │  (edge/server)    │  context +     │  QueryEngine│
        └─────────────┘◀──────────────└──────────┬─────────┘  답변 스트림    └─────┬──────┘
                ▲        websocket / SSE              │                        DB  │
                │                                     │ embed + upsert            │
                │                             ┌───────▼────────┐                 │
                │                             │ Gemini Embed   │                 │
                │                             └────┬───────────┘                 │
                │                                  │                             │
                │                                  ▼                             ▼
                │                         ┌────────────────┐           ┌────────────────┐
                │                         │  Qdrant Vector │◀──────────┤   Postgres/TBD │
                │                         └────────────────┘   payload └────────────────┘

        PDF → LlamaParse/LlamaIndex.TS 청킹 → Gemini-3 072(↓768) 임베딩 → Qdrant 저장
        Next.js + Vercel AI SDK `useChat` + shadcn/ui 채팅 UI
        Docker-Qdrant 로컬, Vercel(Prod) 배포 … (기타 세부 설명 생략)

    (… 전체 아키텍처 / 패키지 인스톨 / UI 코드 예시는 그대로 보관하였습니다.)

    ────────────────────────────────────────
    2. What Has Been Implemented
    ────────────────────────────────────────
    Repository was migrated to TypeScript + Airbnb style and the CLI MVP was rewritten.

    • Tooling
      – tsconfig.json (strict ESNext)
      – ESLint + airbnb-base + airbnb-typescript + import/jsdoc/unused-imports
      – Dev scripts (build, ingest, query, lint) in package.json
      – Dependencies added: typescript, ts-node, eslint stack, @types/node

    • src/config.ts
      – Env loader (dotenv/config)
      – Singleton factories for Google Gemini + Qdrant
      – embedText(text) → Float32Array (+simple cache) with Gemini-embedding-exp-03-07 (768-d)

    • src/ingest.ts (CLI)
      – Recursive walk of a directory for *.txt / *.md / .pdf
      – PDF extraction via pdfjs-lib (lazy import)
      – Paragraph splitter, per-paragraph Gemini embedding, upsert to Qdrant collection pdf_chat_embeddings (size = 768, Cosine)

    • src/query.ts (CLI)
      – Interactive REPL or one-shot query
      – Embeds the question, performs Top-5 similarity search in Qdrant, prints chunks & scores

    • Removed legacy .js files; all logic now lives in .ts.

    You can run:

        npm install          # installs new dev & prod deps
        npm run build        # type-checks and emits dist/
        npm run ingest ./data_or_examples
        npm run query "What is …?"
        npm run query        # interactive mode
        npm run lint         # Airbnb lint check

    ────────────────────────────────────────
    3. Remaining Tasks / Roadmap
    ────────────────────────────────────────
    Backend

        1. **Switch to LlamaParse** for higher-fidelity PDF parsing (replace pdfjs logic).
        2. **Incremental / cached indexing** – serialize index or track file hashes to avoid re-embedding unchanged docs.
        3. **Qdrant metadata**
           • store page #, file path, section heading, etc.
           • add hybrid keyword filter if needed.
        4. **Implement actual Next.js API route** (`app/api/chat/route.ts`)
           – Load VectorStoreIndex from Qdrant
           – Use `index.asQueryEngine({ similarityTopK })` → `queryStream()`
           – Return SSE compatible with Vercel AI SDK.
        5. **Authentication / multi-tenant collections** (optional).

    Frontend

        1. Create **Next.js App Router pages**
           • `/chat` page using `useChat` (progressively render stream).
           • file-upload component (`/api/upload`).
        2. Add **shadcn/ui chat bubbles** + skeleton loaders.
        3. Use **SWR / React Query** to show ingestion progress.

    Dev-ops

        1. Add **Docker compose** for local `qdrant` + dev server.
        2. **Pre-commit** hook to run `npm run lint`.
        3. Vercel / Fly / Render deploy scripts + secrets (GEMINI_API_KEY, QDRANT_URL).

    Stretch
    • Rerank answers with Gemini Pro.
    • Cite source page numbers.
    • Implement streaming HTML/Markdown renderer with syntax highlighting.

    Feel free to let me know which of these next tasks you’d like automated next!
