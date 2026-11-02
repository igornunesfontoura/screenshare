import { AlertTriangle, Loader2, MonitorUp, Square } from "lucide-react";
import type { UseCapture } from "../hooks/useCapture";
import {
  BITRATE_RANGE,
  QUALITY_PRESETS,
  RESOLUTIONS,
  matchesPreset,
  type ContentKind,
  type Resolution,
} from "../lib/capture";
import { AudioMeter } from "./AudioMeter";
import { SourcePicker } from "./SourcePicker";
import { VideoView } from "./VideoView";

export function SharePanel({ capture }: { capture: UseCapture }) {
  const { status, settings, updateSettings } = capture;
  const live = status === "live";
  const busy = status === "starting" || status === "picking";

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <MonitorUp className="h-5 w-5 text-emerald-400" />
          Transmissão
          {live && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
              AO VIVO
            </span>
          )}
        </h2>
        {live ? (
          <button
            type="button"
            onClick={capture.stop}
            className="flex items-center gap-2 rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
          >
            <Square className="h-4 w-4" />
            Parar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void capture.begin()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-void transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Compartilhar tela
          </button>
        )}
      </div>

      {capture.error && (
        <p className="mb-4 flex items-center gap-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {capture.error}
        </p>
      )}

      {live && (
        <div className="mb-4 space-y-2">
          <div className="aspect-video overflow-hidden rounded-lg border border-border">
            <VideoView stream={capture.stream} muted />
          </div>
          {capture.stream?.getAudioTracks().length ? (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              Áudio do sistema
              <AudioMeter stream={capture.stream} label="Nível do áudio transmitido" className="flex-1" />
            </div>
          ) : null}
        </div>
      )}

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm text-slate-400">Qualidade</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUALITY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => updateSettings(preset.settings)}
              aria-pressed={matchesPreset(settings, preset.settings)}
              className="rounded-lg border border-border px-3 py-2 text-left transition hover:border-slate-500 aria-pressed:border-emerald-400 aria-pressed:bg-emerald-400/5"
            >
              <span className="block text-sm font-medium">{preset.label}</span>
              <span className="block text-xs text-slate-500">{preset.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-slate-400">Resolução máxima</span>
          <select
            value={settings.resolution}
            onChange={(e) => updateSettings({ resolution: e.currentTarget.value as Resolution })}
            className="w-full rounded-lg border border-border bg-void px-3 py-2 outline-none focus:border-cyan-400"
          >
            {Object.entries(RESOLUTIONS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-slate-400">Taxa de quadros</legend>
          <div className="flex gap-2">
            {([30, 60] as const).map((fps) => (
              <button
                key={fps}
                type="button"
                onClick={() => updateSettings({ fps })}
                aria-pressed={settings.fps === fps}
                className="flex-1 rounded-lg border border-border py-2 transition aria-pressed:border-cyan-400 aria-pressed:text-cyan-300"
              >
                {fps} FPS
              </button>
            ))}
          </div>
        </fieldset>

        <label className="space-y-1.5 sm:col-span-2">
          <span className="flex justify-between text-slate-400">
            Bitrate máximo
            <span className="font-mono text-slate-200">{settings.bitrateMbps} Mbps</span>
          </span>
          <input
            type="range"
            min={BITRATE_RANGE.min}
            max={BITRATE_RANGE.max}
            value={settings.bitrateMbps}
            onChange={(e) => updateSettings({ bitrateMbps: Number(e.currentTarget.value) })}
            className="w-full accent-emerald-400"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-slate-400">Conteúdo</span>
          <select
            value={settings.content}
            onChange={(e) => updateSettings({ content: e.currentTarget.value as ContentKind })}
            className="w-full rounded-lg border border-border bg-void px-3 py-2 outline-none focus:border-cyan-400"
          >
            <option value="motion">Filme / jogo (fluidez)</option>
            <option value="detail">Texto / apps (nitidez)</option>
          </select>
        </label>

        <label className="flex items-center gap-3 self-end py-2">
          <input
            type="checkbox"
            checked={settings.systemAudio}
            disabled={live}
            onChange={(e) => updateSettings({ systemAudio: e.currentTarget.checked })}
            className="h-4 w-4 accent-emerald-400"
          />
          <span className={live ? "text-slate-500" : "text-slate-300"}>Áudio do sistema</span>
        </label>
      </div>

      {status === "picking" && (
        <SourcePicker
          sources={capture.sources}
          onChoose={(id) => void capture.choose(id)}
          onCancel={capture.cancelPicking}
        />
      )}
    </section>
  );
}
