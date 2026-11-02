import { useState, type FormEvent } from "react";
import { AlertTriangle, Hourglass, Loader2, LogIn, MonitorUp, Server, UserRound } from "lucide-react";
import {
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
} from "../../../../shared/protocol.ts";
import { usePersistentState } from "../hooks/usePersistentState";
import type { RoomSession } from "../hooks/useRoom";
import { DEFAULT_SIGNALING_URL, isValidSignalingUrl } from "../lib/signaling";

interface HomeProps {
  session: RoomSession;
  error: string | null;
  onCreate(name: string, serverUrl: string): void;
  onJoin(code: string, name: string, serverUrl: string): void;
  onCancel(): void;
}

function randomGuestName(): string {
  return `Convidado-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function Home({ session, error, onCreate, onJoin, onCancel }: HomeProps) {
  const [roomCode, setRoomCode] = useState("");
  const [storedName, setName] = usePersistentState("screenshare:name", randomGuestName);
  const [storedServer, setServerUrl] = usePersistentState(
    "screenshare:server",
    () => DEFAULT_SIGNALING_URL,
  );
  // Valores salvos podem estar corrompidos (não-string); caem para o padrão.
  const name = typeof storedName === "string" ? storedName : "";
  const serverUrl = typeof storedServer === "string" ? storedServer : DEFAULT_SIGNALING_URL;
  const serverValid = isValidSignalingUrl(serverUrl);
  const server = serverUrl.trim();
  const connecting = session.status === "connecting";
  const busy = (role: "host" | "viewer") => connecting && session.role === role;
  const displayName = name.trim() || randomGuestName();

  function submitJoin(e: FormEvent) {
    e.preventDefault();
    if (isValidRoomCode(roomCode) && serverValid) onJoin(roomCode, displayName, server);
  }

  if (session.status === "waiting") {
    return (
      <div className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
        <Hourglass className="mx-auto mb-4 h-10 w-10 animate-pulse text-cyan-400" />
        <h2 className="mb-1 text-xl font-semibold">Aguardando o host</h2>
        <p className="mb-6 text-sm text-slate-400">
          Seu pedido para entrar na sala{" "}
          <span className="font-mono text-slate-200">{session.code}</span> foi enviado.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="m-auto w-full max-w-3xl space-y-6">
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <label className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <UserRound className="h-5 w-5 shrink-0 text-slate-400" />
        <span className="shrink-0 text-sm text-slate-400">Seu nome</span>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={MAX_NAME_LENGTH}
          className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none select-text"
        />
      </label>

      <details className="rounded-xl border border-border bg-surface px-4 py-3" open={!serverValid}>
        <summary className="flex cursor-pointer items-center gap-3 text-sm text-slate-400">
          <Server className="h-4 w-4" />
          Servidor de conexão
          <span className="truncate font-mono text-xs text-slate-500">{server}</span>
        </summary>
        <label className="mt-3 block space-y-1.5 text-sm">
          <span className="text-slate-400">
            Endereço do servidor de signaling (todos na sala precisam usar o mesmo)
          </span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.currentTarget.value)}
            spellCheck={false}
            aria-invalid={!serverValid}
            placeholder="wss://seu-servidor.exemplo.com"
            className="w-full rounded-lg border border-border bg-void px-3 py-2 font-mono outline-none select-text focus:border-cyan-400 aria-invalid:border-red-500/60"
          />
          {!serverValid && (
            <span className="text-xs text-red-300">
              Use wss:// (ws:// só para localhost).
            </span>
          )}
        </label>
      </details>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-6">
          <MonitorUp className="mb-4 h-8 w-8 text-emerald-400" />
          <h2 className="mb-1 text-xl font-semibold">Transmitir</h2>
          <p className="mb-6 text-sm text-slate-400">
            Crie uma sala e compartilhe sua tela em até 4K 60 FPS.
          </p>
          <button
            type="button"
            onClick={() => onCreate(displayName, server)}
            disabled={connecting || !serverValid}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 font-medium text-void transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy("host") && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar sala
          </button>
        </section>

        <section className="rounded-xl border border-border bg-surface p-6">
          <LogIn className="mb-4 h-8 w-8 text-cyan-400" />
          <h2 className="mb-1 text-xl font-semibold">Assistir</h2>
          <p className="mb-6 text-sm text-slate-400">
            Entre em uma sala com o código de {ROOM_CODE_LENGTH} dígitos.
          </p>
          <form onSubmit={submitJoin} className="flex gap-2">
            <input
              value={roomCode}
              onChange={(e) =>
                setRoomCode(e.currentTarget.value.replace(/\D/g, "").slice(0, ROOM_CODE_LENGTH))
              }
              inputMode="numeric"
              placeholder="000000"
              aria-label="Código da sala"
              className="w-full rounded-lg border border-border bg-void px-3 py-2.5 text-center font-mono tracking-[0.4em] outline-none select-text focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={connecting || !serverValid || !isValidRoomCode(roomCode)}
              className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 font-medium text-void transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy("viewer") && <Loader2 className="h-4 w-4 animate-spin" />}
              Entrar
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
