import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Maximize,
  Minimize,
  PictureInPicture2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePersistentState } from "../hooks/usePersistentState";
import type { MediaStats } from "../lib/stats";
import { AudioMeter } from "./AudioMeter";
import { StatsLine } from "./StatsLine";

const HIDE_CONTROLS_MS = 2500;

interface PlayerProps {
  stream: MediaStream | null;
  stats: MediaStats | null;
  placeholder: string | null;
}

// Player do viewer: tela cheia, PiP, volume e estatísticas.
// Atalhos: F tela cheia, M mudo, P picture-in-picture, I estatísticas.
export function Player({ stream, stats, placeholder }: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [storedVolume, setVolume] = usePersistentState("screenshare:volume", () => 1);
  // Valor salvo pode estar corrompido; video.volume fora de 0..1 lança exceção.
  const volume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 1;
  const [muted, setMuted] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, stream]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  const togglePip = useCallback(() => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void videoRef.current?.requestPictureInPicture().catch(() => undefined);
  }, []);

  // "Ativar som" com volume zerado precisa devolver volume audível.
  const toggleMute = useCallback(() => {
    if (volume === 0) {
      setVolume(1);
      setMuted(false);
      return;
    }
    setMuted((m) => !m);
  }, [volume, setVolume]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]");
      // Segurar a tecla não deve alternar tela cheia/mudo repetidamente.
      if (typing || event.repeat || event.ctrlKey || event.metaKey) return;
      const actions: Record<string, () => void> = {
        f: toggleFullscreen,
        m: toggleMute,
        p: togglePip,
        i: () => setShowStats((s) => !s),
      };
      const action = actions[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, toggleMute, togglePip]);

  function revealControls() {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), HIDE_CONTROLS_MS);
  }

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const silent = muted || volume === 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={revealControls}
      onPointerDown={revealControls}
      // Navegação por teclado (Tab) também precisa ver os controles.
      onFocus={revealControls}
      onMouseLeave={() => setControlsVisible(false)}
      onDoubleClick={toggleFullscreen}
      className={`group relative aspect-video overflow-hidden bg-black ${
        fullscreen ? "" : "rounded-lg border border-border"
      } ${controlsVisible ? "" : "cursor-none"}`}
    >
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />

      {placeholder && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-slate-500">
          {placeholder}
        </div>
      )}

      {showStats && !placeholder && (
        <div className="absolute top-3 left-3 rounded bg-black/70 px-2 py-1">
          <StatsLine stats={stats} />
        </div>
      )}

      <div
        onDoubleClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 pb-3 transition-opacity ${
          controlsVisible
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        }`}
      >
        <ControlButton label={silent ? "Ativar som (M)" : "Silenciar (M)"} onClick={toggleMute}>
          {silent ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </ControlButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => {
            setVolume(Number(e.currentTarget.value));
            setMuted(false);
          }}
          className="w-24 accent-cyan-400"
        />
        <AudioMeter stream={stream} label="Nível do áudio recebido" className="w-20" />
        <div className="flex-1" />
        <ControlButton label="Estatísticas (I)" onClick={() => setShowStats((s) => !s)} active={showStats}>
          <Activity className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Picture-in-picture (P)" onClick={togglePip}>
          <PictureInPicture2 className="h-5 w-5" />
        </ControlButton>
        <ControlButton label={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </ControlButton>
      </div>
    </div>
  );
}

interface ControlButtonProps {
  label: string;
  onClick(): void;
  active?: boolean;
  children: ReactNode;
}

function ControlButton({ label, onClick, active = false, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-lg p-1.5 transition hover:bg-white/15 ${active ? "text-cyan-300" : "text-slate-100"}`}
    >
      {children}
    </button>
  );
}
