import { useState } from "react";
import { Check, Copy, Link, LogOut, MonitorPlay, UserX, Users } from "lucide-react";
import { inviteLink } from "../../../../shared/invite.ts";
import { MAX_VIEWERS, type PeerId } from "../../../../shared/protocol.ts";
import type { UseCapture } from "../hooks/useCapture";
import type { UseVoice } from "../hooks/useVoice";
import type { PeerStatus, RoomSession, UseRoom } from "../hooks/useRoom";
import { SIGNALING_URL } from "../lib/signaling";
import { ChatPanel } from "./ChatPanel";
import { ConnectionBadge } from "./ConnectionBadge";
import { JoinRequests } from "./JoinRequests";
import { Player } from "./Player";
import { SharePanel } from "./SharePanel";
import { StatsLine } from "./StatsLine";
import { VoicePanel } from "./VoicePanel";

interface RoomViewProps {
  session: Extract<RoomSession, { status: "in-room" }>;
  room: UseRoom;
  capture: UseCapture;
  voice: UseVoice;
  voiceVolume: number;
  onVoiceVolumeChange(volume: number): void;
}

export function RoomView({
  session,
  room,
  capture,
  voice,
  voiceVolume,
  onVoiceVolumeChange,
}: RoomViewProps) {
  const isHost = session.role === "host";

  return (
    <div className="m-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <RoomHeader
          code={session.code}
          isHost={isHost}
          onLeave={room.leave}
        />
        {isHost ? (
          <>
            <JoinRequests requests={room.requests} onAdmit={room.admit} onReject={room.reject} />
            <SharePanel capture={capture} />
            <ViewerList peers={room.peers} onKick={room.kick} />
          </>
        ) : (
          <HostStream hostName={session.hostName} status={room.peers[session.hostId]} />
        )}
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:h-[calc(100vh-10rem)]">
        <VoicePanel voice={voice} volume={voiceVolume} onVolumeChange={onVoiceVolumeChange} />
        <ChatPanel
          messages={room.messages}
          selfId={session.selfId}
          hostId={session.hostId}
          onSend={room.sendChat}
        />
      </aside>
    </div>
  );
}

interface RoomHeaderProps {
  code: string;
  isHost: boolean;
  onLeave(): void;
}

function RoomHeader({ code, isHost, onLeave }: RoomHeaderProps) {
  const [copied, setCopied] = useState<"code" | "invite" | null>(null);
  const invite = inviteLink(SIGNALING_URL, code);

  async function copy(what: "code" | "invite", text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn("Falha ao copiar", err);
      return;
    }
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-6">
      <div>
        <p className="mb-1 text-xs uppercase tracking-widest text-slate-500">
          {isHost ? "Sua sala" : "Sala"}
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-4xl font-semibold tracking-[0.3em] text-emerald-400 select-text">
            {code}
          </span>
          <button
            type="button"
            onClick={() => copy("code", code)}
            aria-label="Copiar código"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-border hover:text-slate-200"
          >
            {copied === "code" ? (
              <Check className="h-5 w-5 text-emerald-400" />
            ) : (
              <Copy className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {invite && (
          <button
            type="button"
            onClick={() => copy("invite", invite)}
            title={invite}
            className="flex items-center gap-2 rounded-lg border border-emerald-500/40 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/10"
          >
            {copied === "invite" ? <Check className="h-4 w-4" /> : <Link className="h-4 w-4" />}
            {copied === "invite" ? "Convite copiado" : "Copiar convite"}
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
        >
          <LogOut className="h-4 w-4" />
          {isHost ? "Encerrar sala" : "Sair"}
        </button>
      </div>
    </section>
  );
}

function ViewerList({ peers, onKick }: { peers: Record<PeerId, PeerStatus>; onKick(id: PeerId): void }) {
  const viewers = Object.entries(peers);

  return (
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
            <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm text-slate-200">{status.name || id.slice(0, 8)}</span>
                <StatsLine stats={status.stats} />
              </div>
              <div className="flex items-center gap-2">
                <ConnectionBadge status={status} />
                <button
                  type="button"
                  onClick={() => onKick(id)}
                  aria-label={`Remover ${status.name}`}
                  title="Remover da sala"
                  className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                >
                  <UserX className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HostStream({ hostName, status }: { hostName: string; status: PeerStatus | undefined }) {
  const live = Boolean(status?.live && status.stream);
  const placeholder = live
    ? null
    : status?.state === "connected"
      ? `${hostName} ainda não começou a transmitir.`
      : "Conectando ao host…";

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <MonitorPlay className="h-5 w-5 text-cyan-400" />
          Transmissão de {hostName}
        </h2>
        {status && <ConnectionBadge status={status} />}
      </div>
      <Player
        stream={live ? status!.stream : null}
        stats={status?.stats ?? null}
        placeholder={placeholder}
        camera={status?.camera ?? null}
      />
      <p className="mt-3 text-xs text-slate-500">
        Atalhos: F tela cheia · M mudo · P picture-in-picture · I estatísticas · C webcam · duplo clique para tela cheia
      </p>
    </section>
  );
}
