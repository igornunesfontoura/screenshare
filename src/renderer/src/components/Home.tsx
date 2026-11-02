import { useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, LogIn, MonitorUp } from "lucide-react";
import { ROOM_CODE_LENGTH, isValidRoomCode } from "../../../../shared/protocol.ts";
import type { RoomSession } from "../hooks/useRoom";

interface HomeProps {
  session: RoomSession;
  error: string | null;
  onCreate(): void;
  onJoin(code: string): void;
}

export function Home({ session, error, onCreate, onJoin }: HomeProps) {
  const [roomCode, setRoomCode] = useState("");
  const connecting = session.status === "connecting";
  const busy = (role: "host" | "viewer") => connecting && session.role === role;

  function submitJoin(e: FormEvent) {
    e.preventDefault();
    if (isValidRoomCode(roomCode)) onJoin(roomCode);
  }

  return (
    <div className="m-auto w-full max-w-3xl">
      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-6">
          <MonitorUp className="mb-4 h-8 w-8 text-emerald-400" />
          <h2 className="mb-1 text-xl font-semibold">Transmitir</h2>
          <p className="mb-6 text-sm text-slate-400">
            Crie uma sala e compartilhe sua tela em até 4K 60 FPS.
          </p>
          <button
            type="button"
            onClick={onCreate}
            disabled={connecting}
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
              disabled={connecting || !isValidRoomCode(roomCode)}
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
