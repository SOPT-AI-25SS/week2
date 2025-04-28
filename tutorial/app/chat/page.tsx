'use client';

/*
 * Minimal Chat UI using the Vercel AI SDK `useChat` hook.
 * Tailwind / shadcn are optional – basic HTML used, so it runs
 * without additional component deps.
 */

import { useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import Markdown from 'react-markdown';

export default function Chat() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
  } = useChat({ api: '/api/chat' });

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col items-center p-4 mx-auto max-w-2xl">
      <div className="w-full overflow-y-auto border rounded-xl p-4 space-y-3 h-[70vh]">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block px-3 py-2 rounded-xl max-w-full whitespace-pre-wrap text-left ${
                m.role === 'user' ? 'bg-gray-200' : 'bg-green-50'
              }`}
            >
              <Markdown>{m.content}</Markdown>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex w-full gap-2 mt-4">
        <input
          className="flex-1 border rounded px-3 py-2"
          value={input}
          onChange={handleInputChange}
          placeholder="PDF에 대해 질문해 보세요…"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-60"
          disabled={isLoading}
        >
          보내기
        </button>
      </form>
    </div>
  );
}
