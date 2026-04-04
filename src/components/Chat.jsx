import { marked } from "marked";
import DOMPurify from "dompurify";
import { useState, useEffect } from "react";

import "./Chat.css";

function render(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

function ThinkingBlock({ thinking }) {
  const [open, setOpen] = useState(false);
  if (!thinking) return null;

  return (
    <div className="mb-2">
      <button
        className="text-xs text-dm-blue flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        onClick={() => setOpen(!open)}
      >
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        <span>Thinking</span>
        <span className="text-dm-text-secondary/60">({thinking.length} chars)</span>
      </button>
      {open && (
        <div className="mt-2 flex gap-2">
          <div className="w-1.5 rounded-full bg-dm-blue/30 flex-shrink-0" />
          <div className="text-xs text-dm-text-secondary bg-dm-surface-high/60 rounded-lg px-3 py-2 max-h-[200px] overflow-y-auto scrollbar-thin whitespace-pre-wrap leading-relaxed">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Chat({ messages }) {
  const empty = messages.length === 0;

  useEffect(() => {
    window.MathJax?.typeset?.();
  }, [messages]);

  return (
    <div
      className={`flex-1 px-4 py-6 max-w-[800px] w-full ${empty ? "flex flex-col items-center justify-end" : "space-y-3"}`}
    >
      {empty ? (
        <div className="text-lg text-dm-text-secondary">Ready!</div>
      ) : (
        messages.map((msg, i) => (
          <div
            key={`message-${i}`}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" ? (
              <div className="frosted rounded-2xl px-4 py-2.5 max-w-[85%]">
                <ThinkingBlock thinking={msg.thinking} />
                <div className="text-sm leading-relaxed text-dm-text overflow-wrap-anywhere">
                  {msg.content.length > 0 ? (
                    <span
                      className="markdown"
                      dangerouslySetInnerHTML={{
                        __html: render(msg.content),
                      }}
                    />
                  ) : (
                    <span className="flex items-center gap-1 h-5">
                      <span className="size-1.5 rounded-full bg-dm-text-secondary animate-typing-dot" />
                      <span className="size-1.5 rounded-full bg-dm-text-secondary animate-typing-dot animation-delay-200" />
                      <span className="size-1.5 rounded-full bg-dm-text-secondary animate-typing-dot animation-delay-400" />
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="max-w-[85%]">
                {msg.imageUrl && (
                  <img
                    src={msg.imageUrl}
                    className="max-h-48 rounded-xl mb-1.5 ml-auto"
                    alt="attached"
                  />
                )}
                {msg.audio && (
                  <div className="text-xs text-dm-text-secondary mb-1 text-right">
                    Audio attached
                  </div>
                )}
                <div className="bg-dm-surface-higher text-dm-text rounded-2xl px-4 py-2.5 text-sm leading-relaxed overflow-wrap-anywhere">
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
