import { useState } from "react";
import { Check, Copy, LogOut, MonitorPlay, Users } from "lucide-react";
import { MAX_VIEWERS, type PeerId } from "../../../../shared/protocol.ts";
import type { PeerStatus, RoomSession } from "../hooks/useRoom";
import { ConnectionBadge } from "./ConnectionBadge";

interface RoomViewProps {
  session: Extract<RoomSession, { status: "in-room" }>;
  peers: Record<PeerId, PeerStatus>;
  onLeave(): void;
}

export function RoomView({ session, peers, onLeave }: RoomViewProps) {
  const [copied, setCopied] = useState(false);
  const isHost = session.role === "host";
  const viewers = Object.entries(peers);
  const hostStatus = peers[session.hostId];

  async function copyCode() {
    await navigator.clipboard.writeText(session.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="m-auto w-full max-w-3xl space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-6">
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-slate-500">
            {isHost ? "Sua sala" : "Sala"}
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-4xl font-semibold tracking-[0.3em] text-emerald-400 select-text">
              {session.code}
            </span>
            <button
              type="button"
              onClick={copyCode}
              aria-label="Copiar código"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-border hover:text-slate-200"
            >
              {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
        >
          <LogOut className="h-4 w-4" />
          {isHost ? "Encerrar sala" : "Sair"}
        </button>
      </section>

      {isHost ? (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Users className="h-5 w-5 text-cyan-400" />
              Espectadores
            </h2>
            <span className="text-sm text-slate-500">
              {viewers.length}/{MAX_VIEWERS}
            </span>
          </div>
          {viewers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Aguardando espectadores. Compartilhe o código acima.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {viewers.map(([id, status]) => (
                <li key={id} className="flex items-center justify-between py-3">
                  <span className="font-mono text-sm text-slate-300">{id.slice(0, 8)}</span>
                  <ConnectionBadge status={status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <MonitorPlay className="h-5 w-5 text-cyan-400" />
              Transmissão
            </h2>
            {hostStatus && <ConnectionBadge status={hostStatus} />}
          </div>
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border text-sm text-slate-500">
            O vídeo do host aparece aqui na Fase 3.
          </div>
        </section>
      )}
    </div>
  );
}
