import { Headphones, Mic, MicOff, Radio } from "lucide-react";
import type { UseVoice } from "../hooks/useVoice";
import { PTT_LABEL, type VoiceMode } from "../lib/voice";
import { AudioMeter } from "./AudioMeter";

const MODES: { mode: VoiceMode; label: string }[] = [
  { mode: "off", label: "Desligado" },
  { mode: "ptt", label: `Segurar ${PTT_LABEL}` },
  { mode: "open", label: "Aberto" },
];

interface VoicePanelProps {
  voice: UseVoice;
  volume: number;
  onVolumeChange(volume: number): void;
}

export function VoicePanel({ voice, volume, onVolumeChange }: VoicePanelProps) {
  const status =
    voice.mode === "off"
      ? "Microfone desligado"
      : voice.transmitting
        ? "Transmitindo"
        : voice.mode === "ptt"
          ? `Segure ${PTT_LABEL} para falar (com a janela em foco)`
          : "Abrindo microfone…";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Radio className="h-5 w-5 text-cyan-400" />
        Voz
      </h2>

      <div role="radiogroup" aria-label="Modo do microfone" className="grid grid-cols-3 gap-1.5">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={voice.mode === mode}
            onClick={() => voice.setMode(mode)}
            className="rounded-lg border border-border px-2 py-1.5 text-xs transition hover:border-slate-500 aria-checked:border-cyan-400 aria-checked:text-cyan-300"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs">
        {voice.transmitting ? (
          <Mic className="h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <MicOff className="h-4 w-4 shrink-0 text-slate-500" />
        )}
        <span className={voice.transmitting ? "text-emerald-300" : "text-slate-400"}>{status}</span>
      </div>
      {voice.micStream && (
        <AudioMeter stream={voice.micStream} label="Nível do microfone" />
      )}
      {voice.error && <p className="text-xs text-red-300">{voice.error}</p>}

      <label className="flex items-center gap-3 text-xs text-slate-400">
        <Headphones className="h-4 w-4 shrink-0" />
        Vozes
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume das vozes"
          onChange={(e) => onVolumeChange(Number(e.currentTarget.value))}
          className="flex-1 accent-cyan-400"
        />
      </label>
    </section>
  );
}
