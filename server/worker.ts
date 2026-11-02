import { DurableObject } from "cloudflare:workers";
import { KEEPALIVE_MS, type ServerMessage } from "../shared/protocol.ts";
import { MAX_MESSAGE_BYTES, receive } from "./handler.ts";
import { httpPage } from "./http-page.ts";
import { JoinRateLimiter } from "./rate-limit.ts";
import { RoomRegistry, type Peer } from "./rooms.ts";

// Mesmo protocolo do servidor Node (index.ts), rodando no Cloudflare Workers.
// Todas as salas vivem num único Durable Object: o código de 6 dígitos precisa ser
// único e o volume (só SDP/ICE) é pequeno.

interface Env {
  HUB: DurableObjectNamespace<SignalingHub>;
  // Só para os testes (wrangler dev --var); em produção valem os padrões.
  PENDING_TIMEOUT_MS?: string;
  JOINS_PER_MINUTE?: string;
}

// Sem mensagem (nem o ping do cliente) por esse tempo, a conexão é dada como morta.
const SILENCE_LIMIT_MS = KEEPALIVE_MS * 2.5;

export default {
  async fetch(request, env): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return env.HUB.get(env.HUB.idFromName("global")).fetch(request);
    }
    const page = httpPage(request.url);
    return new Response(page.body, { headers: { "content-type": page.type } });
  },
} satisfies ExportedHandler<Env>;

export class SignalingHub extends DurableObject<Env> {
  private readonly registry: RoomRegistry;
  private readonly joinLimiter: JoinRateLimiter;
  private readonly connections = new Map<WebSocket, Connection>();
  private reaper: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.registry = new RoomRegistry(optionalNumber(env.PENDING_TIMEOUT_MS));
    this.joinLimiter = new JoinRateLimiter(optionalNumber(env.JOINS_PER_MINUTE));
  }

  // Sem a API de hibernação: o estado das salas fica em memória enquanto houver
  // conexões abertas. Sem conexões o objeto é descartado e não consome cota.
  async fetch(request: Request): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const peer: Peer = {
      id: RoomRegistry.newPeerId(),
      send(message: ServerMessage) {
        if (server.readyState === WebSocket.OPEN) server.send(JSON.stringify(message));
      },
    };
    // Libera a sala na hora, sem esperar o evento "close": um peer morto (notebook
    // suspenso) nunca responde ao close e o evento só viria minutos depois.
    const drop = (code?: number, reason?: string) => {
      if (!this.connections.delete(server)) return;
      this.registry.leave(peer);
      try {
        server.close(code, reason);
      } catch {
        // Já fechado.
      }
      if (this.connections.size === 0) this.stopReaper();
    };
    const connection: Connection = { lastSeen: Date.now(), drop };
    this.connections.set(server, connection);
    this.startReaper();

    server.addEventListener("message", (event) => {
      // Depois do drop o runtime ainda entrega mensagens até o close do cliente;
      // tratá-las criaria salas que nunca seriam liberadas.
      if (!this.connections.has(server)) return;
      if (typeof event.data !== "string" || utf8Bytes(event.data) > MAX_MESSAGE_BYTES) {
        drop(1009, "Mensagem grande demais.");
        return;
      }
      connection.lastSeen = Date.now();
      receive(this.registry, peer, event.data, () => this.joinLimiter.allow(ip));
    });
    server.addEventListener("close", () => drop());
    server.addEventListener("error", () => drop());

    return new Response(null, { status: 101, webSocket: client });
  }

  // O timer só existe com conexões abertas, senão o objeto nunca seria descartado.
  private startReaper(): void {
    this.reaper ??= setInterval(() => {
      const now = Date.now();
      for (const connection of [...this.connections.values()]) {
        if (now - connection.lastSeen > SILENCE_LIMIT_MS) connection.drop(1001, "Sem resposta.");
      }
      this.joinLimiter.prune();
    }, KEEPALIVE_MS);
  }

  private stopReaper(): void {
    if (this.reaper === undefined) return;
    clearInterval(this.reaper);
    this.reaper = undefined;
  }
}

interface Connection {
  lastSeen: number;
  drop(code?: number, reason?: string): void;
}

// Mesmo limite do maxPayload do servidor Node, que conta bytes e não caracteres.
function utf8Bytes(text: string): number {
  return text.length * 3 <= MAX_MESSAGE_BYTES ? text.length : new TextEncoder().encode(text).byteLength;
}

function optionalNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : undefined;
}
