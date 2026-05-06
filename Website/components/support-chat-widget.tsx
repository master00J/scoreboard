"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { usePathname } from "next/navigation";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const STORAGE_KEY = "arenacue_support_chat_v1";
const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hoi, ik ben de ArenaCue support-assistent. Stel gerust een vraag over de software, mobiele app of LED boarding — ik antwoord direct.",
};

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function SupportChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Message[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [open]);

  const hidden = useMemo(() => {
    if (!pathname) return false;
    return pathname.startsWith("/admin");
  }, [pathname]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const userMsg: Message = {
        id: makeId(),
        role: "user",
        content: trimmed,
      };
      const assistantId = makeId();
      const placeholder: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, placeholder]);
      setInput("");
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const conversation = [...messages, userMsg]
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch("/api/support/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: conversation }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let errMsg = "Er ging iets mis. Probeer het later opnieuw.";
          try {
            const data = await res.json();
            if (data?.error) errMsg = String(data.error);
          } catch {
            /* ignore */
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: errMsg } : m,
            ),
          );
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: buffered } : m,
            ),
          );
        }
        if (!buffered.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      "Sorry, ik kon geen antwoord opstellen. Probeer het opnieuw of mail info@arenacue.be.",
                  }
                : m,
            ),
          );
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "Verbinding met de chat-service is verbroken. Probeer het opnieuw.",
                }
              : m,
          ),
        );
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void sendMessage(input);
    },
    [input, sendMessage],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    setBusy(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  if (hidden) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="support-chat-launcher"
          aria-label="Open support chat"
          onClick={() => setOpen(true)}
        >
          <span className="support-chat-launcher-dot" aria-hidden />
          <span className="support-chat-launcher-text">Hulp nodig?</span>
        </button>
      )}

      {open && (
        <div className="support-chat-panel" role="dialog" aria-label="ArenaCue support chat">
          <header className="support-chat-header">
            <div className="support-chat-header-id">
              <span className="support-chat-avatar" aria-hidden>
                AC
              </span>
              <div>
                <p className="support-chat-title">ArenaCue support</p>
                <p className="support-chat-subtitle">
                  <span className="support-chat-online" /> Direct antwoord
                </p>
              </div>
            </div>
            <div className="support-chat-actions">
              <button
                type="button"
                className="support-chat-icon-btn"
                onClick={resetChat}
                aria-label="Gesprek opnieuw starten"
                title="Gesprek opnieuw starten"
              >
                ↺
              </button>
              <button
                type="button"
                className="support-chat-icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Sluit chat"
              >
                ×
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="support-chat-messages">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "support-chat-bubble support-chat-bubble-user"
                    : "support-chat-bubble support-chat-bubble-assistant"
                }
              >
                {m.content || (m.role === "assistant" && busy ? <TypingDots /> : null)}
              </div>
            ))}
          </div>

          <form className="support-chat-input" onSubmit={onSubmit}>
            <textarea
              ref={textareaRef}
              value={input}
              placeholder="Stel een vraag..."
              rows={2}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              {busy ? "Bezig..." : "Verstuur"}
            </button>
          </form>

          <p className="support-chat-disclaimer">
            AI-assistent. Voor commerciele of juridische zaken: info@arenacue.be.
          </p>
        </div>
      )}
    </>
  );
}

function TypingDots() {
  return (
    <span className="support-chat-typing" aria-label="aan het typen">
      <span />
      <span />
      <span />
    </span>
  );
}
