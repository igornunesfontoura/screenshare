import { useEffect, useState } from "react";
import { Cpu, LogIn, MonitorUp, Radio } from "lucide-react";
import { getPlatformInfo, type PlatformInfo } from "./lib/platform";

function App() {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    // Fora do Tauri (ex.: `npm run dev` no navegador) o invoke falha; ignoramos.
    getPlatformInfo().then(setPlatform).catch(() => setPlatform(null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Radio className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-semibold tracking-wide">
            Screen<span className="text-cyan-400">Share</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Cpu className="h-4 w-4" />
          {platform
            ? `${platform.os} · ${platform.arch} · ${platform.captureBackend}`
            : "modo navegador"}
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="grid w-full max-w-3xl gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-6">
            <MonitorUp className="mb-4 h-8 w-8 text-emerald-400" />
            <h2 className="mb-1 text-xl font-semibold">Transmitir</h2>
            <p className="mb-6 text-sm text-slate-400">
              Crie uma sala e compartilhe sua tela em até 4K 60 FPS.
            </p>
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-emerald-500 py-2.5 font-medium text-void transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Criar sala
            </button>
          </section>

          <section className="rounded-xl border border-border bg-surface p-6">
            <LogIn className="mb-4 h-8 w-8 text-cyan-400" />
            <h2 className="mb-1 text-xl font-semibold">Assistir</h2>
            <p className="mb-6 text-sm text-slate-400">
              Entre em uma sala com o código de 6 dígitos.
            </p>
            <div className="flex gap-2">
              <input
                value={roomCode}
                onChange={(e) =>
                  setRoomCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                placeholder="000000"
                className="w-full rounded-lg border border-border bg-void px-3 py-2.5 text-center font-mono tracking-[0.4em] outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                disabled
                className="rounded-lg bg-cyan-500 px-4 font-medium text-void transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Entrar
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-3 text-xs text-slate-500">
        Fase 1 · scaffold — conexão P2P chega na Fase 2
      </footer>
    </div>
  );
}

export default App;
