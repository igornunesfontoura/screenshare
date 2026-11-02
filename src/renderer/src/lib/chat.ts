import type { PeerId } from "../../../../shared/protocol.ts";

export const MAX_CHAT_LENGTH = 500;
export const MAX_CHAT_HISTORY = 200;

export interface ChatMessage {
  id: string;
  // "system" para avisos gerados pelo host (entrou/saiu).
  kind: "user" | "system";
  from: PeerId;
  name: string;
  text: string;
  ts: number;
}

// Texto vindo de outro peer é não confiável: tipo, tamanho e vazio são checados.
export function cleanChatText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.trim().slice(0, MAX_CHAT_LENGTH);
  return clean || null;
}

export function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.kind === "user" || m.kind === "system") &&
    typeof m.from === "string" &&
    typeof m.name === "string" &&
    typeof m.text === "string" &&
    m.text.length <= MAX_CHAT_LENGTH &&
    typeof m.ts === "number"
  );
}

const RATE_WINDOW_MS = 5000;
const RATE_MAX_MESSAGES = 5;

// Janela fixa por peer: o host não repassa flood de um viewer para a sala toda.
export class ChatRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  allow(peerId: string, now = Date.now()): boolean {
    const current = this.windows.get(peerId);
    if (!current || now - current.start >= RATE_WINDOW_MS) {
      this.windows.set(peerId, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= RATE_MAX_MESSAGES;
  }

  forget(peerId: string): void {
    this.windows.delete(peerId);
  }
}

export function appendMessage(history: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...history, message];
  return next.length > MAX_CHAT_HISTORY ? next.slice(-MAX_CHAT_HISTORY) : next;
}
