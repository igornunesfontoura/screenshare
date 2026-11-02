import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { MAX_CHAT_LENGTH, type ChatMessage } from "../lib/chat";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  hostId: string;
  onSend(text: string): boolean;
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ messages, selfId, hostId, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [notSent, setNotSent] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Rola para a última mensagem, a menos que o usuário esteja lendo o histórico.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    // Se o canal ainda está abrindo, mantém o rascunho para reenviar.
    const sent = onSend(draft);
    setNotSent(!sent);
    if (sent) setDraft("");
  }

  return (
    <section className="flex h-[32rem] flex-col rounded-xl border border-border bg-surface lg:h-full lg:min-h-[28rem]">
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 font-semibold">
        <MessageSquare className="h-5 w-5 text-cyan-400" />
        Chat
      </h2>
      <ol ref={listRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <li className="py-6 text-center text-slate-500">Nenhuma mensagem ainda.</li>
        )}
        {messages.map((m) =>
          m.kind === "system" ? (
            <li key={m.id} className="text-center text-xs text-slate-500">
              {m.text}
            </li>
          ) : (
            <li key={m.id} className="space-y-0.5 select-text">
              <div className="flex items-baseline gap-2">
                <span className={`font-medium ${m.from === selfId ? "text-emerald-300" : "text-cyan-300"}`}>
                  {m.name}
                </span>
                {/* Nomes podem se repetir; o selo identifica o host de verdade. */}
                {m.from === hostId && (
                  <span className="rounded bg-emerald-400/15 px-1.5 text-[10px] font-semibold tracking-wide text-emerald-300 uppercase">
                    host
                  </span>
                )}
                <time className="text-xs text-slate-500">{TIME.format(m.ts)}</time>
              </div>
              <p className="break-words whitespace-pre-wrap text-slate-200">{m.text}</p>
            </li>
          ),
        )}
      </ol>
      {notSent && (
        <p role="status" className="px-4 pb-1 text-xs text-amber-300">
          Conexão com o host ainda abrindo; tente enviar de novo.
        </p>
      )}
      <form onSubmit={submit} className="flex gap-2 border-t border-border p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Escreva uma mensagem…"
          aria-label="Mensagem"
          className="min-w-0 flex-1 rounded-lg border border-border bg-void px-3 py-2 text-sm outline-none select-text focus:border-cyan-400"
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={!draft.trim()}
          className="rounded-lg bg-cyan-500 px-3 text-void transition hover:bg-cyan-400 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
