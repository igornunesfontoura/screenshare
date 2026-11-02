import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  RESOLUTIONS,
  listSources,
  startCapture,
  stopCapture,
  type CaptureSettings,
  type CaptureSource,
} from "../lib/capture";
import type { SendParams } from "../lib/peer";
import type { OutgoingMedia } from "./useRoom";

export type CaptureStatus = "idle" | "picking" | "starting" | "live";

export interface UseCapture {
  status: CaptureStatus;
  stream: MediaStream | null;
  sources: CaptureSource[];
  settings: CaptureSettings;
  error: string | null;
  outgoing: OutgoingMedia;
  updateSettings(patch: Partial<CaptureSettings>): void;
  begin(): Promise<void>;
  choose(sourceId: string): Promise<void>;
  cancelPicking(): void;
  stop(): void;
}

export function useCapture(): UseCapture {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Incrementa a cada stop; capturas que terminam depois disso são descartadas.
  const generation = useRef(0);
  const busy = useRef(false);

  const stop = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    if (streamRef.current) stopCapture(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setSources([]);
    setStatus("idle");
  }, []);

  const start = useCallback(
    async (sourceId: string | null) => {
      const attempt = generation.current;
      busy.current = true;
      setStatus("starting");
      setError(null);
      try {
        const { stream: next, warning } = await startCapture(sourceId, settings);
        if (attempt !== generation.current) {
          // Parado enquanto a captura abria: libera tracks e o áudio do sistema.
          stopCapture(next);
          return;
        }
        const video = next.getVideoTracks()[0];
        // O usuário pode parar pelo próprio sistema (portal, barra do Windows),
        // inclusive antes deste listener existir.
        video?.addEventListener("ended", () => {
          if (streamRef.current === next) stop();
        });
        if (video?.readyState === "ended") return stop();

        busy.current = false;
        streamRef.current = next;
        setStream(next);
        setStatus("live");
        setError(warning);
      } catch (err) {
        if (attempt !== generation.current) return;
        stop();
        setError(describeError(err));
      }
    },
    [settings, stop],
  );

  const begin = useCallback(async () => {
    // Clique duplo em "Compartilhar" não pode abrir duas capturas.
    if (busy.current || streamRef.current) return;
    busy.current = true;
    setStatus("starting");
    setError(null);
    try {
      const listing = await listSources();
      if (listing.picker === "system") return start(null);
      setSources(listing.sources);
      setStatus("picking");
    } catch (err) {
      busy.current = false;
      setStatus("idle");
      setError(describeError(err));
    }
  }, [start]);

  const cancelPicking = useCallback(() => {
    busy.current = false;
    setSources([]);
    setStatus("idle");
  }, []);

  const updateSettings = useCallback((patch: Partial<CaptureSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Resolução, FPS e tipo de conteúdo mudam ao vivo, sem recapturar.
  useEffect(() => {
    const video = stream?.getVideoTracks()[0];
    if (!video) return;
    const { width, height } = RESOLUTIONS[settings.resolution];
    video.contentHint = settings.content;
    video
      .applyConstraints({
        width: { ideal: width, max: width },
        height: { ideal: height, max: height },
        frameRate: { ideal: settings.fps, max: settings.fps },
      })
      .catch((err: unknown) => console.warn("Falha ao aplicar resolução/FPS", err));
  }, [stream, settings.resolution, settings.fps, settings.content]);

  useEffect(() => stop, [stop]);

  const params = useMemo<SendParams>(
    () => ({
      maxBitrate: settings.bitrateMbps * 1_000_000,
      maxFramerate: settings.fps,
      degradation: settings.content === "motion" ? "maintain-framerate" : "maintain-resolution",
    }),
    [settings.bitrateMbps, settings.fps, settings.content],
  );
  const outgoing = useMemo<OutgoingMedia>(() => ({ stream, params }), [stream, params]);

  return {
    status,
    stream,
    sources,
    settings,
    error,
    outgoing,
    updateSettings,
    begin,
    choose: start,
    cancelPicking,
    stop,
  };
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Compartilhamento cancelado.";
  }
  return err instanceof Error ? err.message : String(err);
}
