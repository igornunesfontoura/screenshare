import { AppWindow, Monitor, X } from "lucide-react";
import type { CaptureSource } from "../lib/capture";

interface SourcePickerProps {
  sources: CaptureSource[];
  onChoose(sourceId: string): void;
  onCancel(): void;
}

// Seletor próprio para Windows/X11; no Wayland quem escolhe é o portal do sistema.
export function SourcePicker({ sources, onChoose, onCancel }: SourcePickerProps) {
  const screens = sources.filter((s) => s.kind === "screen");
  const windows = sources.filter((s) => s.kind === "window");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escolher o que compartilhar"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-xl border border-border bg-surface">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold">O que você quer compartilhar?</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-border hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-6 overflow-y-auto p-6">
          <SourceGroup title="Telas" icon={Monitor} sources={screens} onChoose={onChoose} />
          <SourceGroup title="Janelas" icon={AppWindow} sources={windows} onChoose={onChoose} />
        </div>
      </div>
    </div>
  );
}

interface SourceGroupProps {
  title: string;
  icon: typeof Monitor;
  sources: CaptureSource[];
  onChoose(sourceId: string): void;
}

function SourceGroup({ title, icon: Icon, sources, onChoose }: SourceGroupProps) {
  if (!sources.length) return null;
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm text-slate-400">
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => onChoose(source.id)}
            className="group rounded-lg border border-border p-2 text-left transition hover:border-emerald-400"
          >
            <img
              src={source.thumbnail}
              alt=""
              className="mb-2 aspect-video w-full rounded bg-black object-contain"
            />
            <span className="line-clamp-1 text-xs text-slate-300 group-hover:text-slate-100">
              {source.name}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
