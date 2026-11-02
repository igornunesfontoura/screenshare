import { ROOM_CODE_LENGTH } from "./protocol.ts";

// Convite = servidor de signaling + código da sala num link só:
//   wss://sinal.exemplo.com + 123456  →  https://sinal.exemplo.com/j/123456
// É https para ficar clicável em chats; o servidor no Workers responde nesse
// endereço com uma página explicando como entrar.

export interface Invite {
  serverUrl: string;
  code: string;
}

const INVITE_PATH = new RegExp(`^(.*)/j/(\\d{${ROOM_CODE_LENGTH}})/?$`);

export function inviteLink(serverUrl: string, code: string): string | null {
  const url = URL.parse(serverUrl.trim());
  if (!url || (url.protocol !== "wss:" && url.protocol !== "ws:")) return null;
  // O convite só leva host e caminho; token na query ou credenciais se perderiam.
  if (url.search || url.username || url.password) return null;
  const scheme = url.protocol === "wss:" ? "https:" : "http:";
  return `${scheme}//${url.host}${url.pathname.replace(/\/+$/, "")}/j/${code}`;
}

// Aceita o link sozinho ou no meio de um texto colado ("entra aí: https://…").
export function parseInvite(text: string): Invite | null {
  const candidate = text.match(/https?:\/\/\S+/)?.[0];
  const url = candidate ? URL.parse(candidate) : null;
  const match = url?.pathname.match(INVITE_PATH);
  if (!url || !match) return null;
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return { serverUrl: `${scheme}//${url.host}${match[1]}`, code: match[2] };
}
