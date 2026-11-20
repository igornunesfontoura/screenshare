import { AppWindow } from "lucide-react";
import type { UseAudioApps } from "../hooks/useAudioApps";

// Quais apps entram no áudio da transmissão. Vale na hora, inclusive ao vivo.
export function AudioAppsPicker({ audioApps }: { audioApps: UseAudioApps }) {
  if (!audioApps.supported) {
    return (
      <p className="text-xs text-slate-500">
        Este sistema só captura o áudio inteiro; a escolha por app não está disponível.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 flex items-center gap-2 text-sm text-slate-400">
        <AppWindow className="h-4 w-4" />
        Apps no áudio da transmissão
      </legend>
      {audioApps.apps.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum app tocando áudio agora.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {audioApps.apps.map((app) => (
            <li key={app.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm transition hover:border-slate-500">
                <input
                  type="checkbox"
                  checked={!app.blocked}
                  onChange={() => audioApps.toggle(app)}
                  className="h-4 w-4 accent-emerald-400"
                />
                <span className={`min-w-0 flex-1 truncate ${app.blocked ? "text-slate-500 line-through" : ""}`}>
                  {app.name}
                </span>
                {!app.present && <span className="shrink-0 text-xs text-slate-600">sem áudio agora</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">Apps que começarem a tocar depois entram automaticamente.</p>
    </fieldset>
  );
}
