import type { ClientMessage, ServerMessage } from "../../../../shared/protocol.ts";

export const SIGNALING_URL: string =
  import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:8787";

export interface SignalingHandlers {
  onMessage(message: ServerMessage): void;
  onClose(): void;
}

// Canal WebSocket com o servidor de signaling (troca de SDP/ICE e eventos de sala).
export class SignalingClient {
  private readonly ws: WebSocket;
  private closedByUs = false;

  private constructor(ws: WebSocket, handlers: SignalingHandlers) {
    this.ws = ws;
    ws.onmessage = (event) => {
      handlers.onMessage(JSON.parse(event.data as string) as ServerMessage);
    };
    ws.onclose = () => {
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
    this.send({ type: "leave" });
    this.ws.close();
  }
}
