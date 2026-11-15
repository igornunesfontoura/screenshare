import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateStatus } from "../../../../shared/platform.ts";
import { bridge, hasBridge } from "../lib/platform";

// Aviso de versão nova no cabeçalho. Reiniciar no meio da sala derrubaria a
// transmissão, então o botão só funciona fora dela (a versão também instala ao fechar o app).
export function UpdateNotice({ inRoom }: { inRoom: boolean }) {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    if (!hasBridge()) return;
    const unsubscribe = bridge().onUpdateStatus(setStatus);
    bridge().updateStatus().then(setStatus).catch(() => {});
    return unsubscribe;
  }, []);

  switch (status.state) {
    case "idle":
      return null;
    case "downloading":
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <Download className="h-3.5 w-3.5" />
          Baixando v{status.version} · {status.percent}%
        </span>
      );
    case "ready":
      return (
        <button
          type="button"
          disabled={inRoom}
          onClick={() => void bridge().installUpdate()}
          title={inRoom ? "Saia da sala para reiniciar (ou a versão instala ao fechar o app)" : undefined}
          className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reiniciar para atualizar (v{status.version})
        </button>
      );
    case "available":
      return (
        <a
          href={status.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25"
        >
          <Download className="h-3.5 w-3.5" />
          v{status.version} disponível — baixar
        </a>
      );
  }
}
