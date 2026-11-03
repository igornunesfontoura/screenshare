import {
  KEEPALIVE_MS,
  type ClientMessage,
  type ServerMessage,
} from "../../../../shared/protocol.ts";

// Definido no build (.env.production aponta para o servidor no Cloudflare Workers).
export const SIGNALING_URL: string = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8787";

export interface SignalingHandlers {
  onMessage(message: ServerMessage): void;
  onClose(): void;
}

// Canal WebSocket com o servidor de signaling (troca de SDP/ICE e eventos de sala).
export class SignalingClient {
  private readonly ws: WebSocket;
  private closedByUs = false;
  // Durante um filme o canal fica ocioso por horas; sem isso o proxy o derruba.
  private readonly keepalive = window.setInterval(() => this.send({ type: "ping" }), KEEPALIVE_MS);

  private constructor(ws: WebSocket, handlers: SignalingHandlers) {
    this.ws = ws;
    ws.onmessage = (event) => {
      handlers.onMessage(JSON.parse(event.data as string) as ServerMessage);
    };
    ws.onclose = () => {
      window.clearInterval(this.keepalive);
      if (!this.closedByUs) handlers.onClose();
    };
  }

  static connect(url: string, handlers: SignalingHandlers): Promise<SignalingClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new SignalingClient(ws, handlers));
      ws.onerror = () => reject(new Error(`Não foi possível conectar a ${url}`));
    });
  }

  send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closedByUs = true;
    window.clearInterval(this.keepalive);
    this.send({ type: "leave" });
    this.ws.close();
  }
}
