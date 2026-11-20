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
import { OVERLAY_CAPTURE, describeCameraError, openCamera } from "../lib/camera";
import type { SendParams } from "../lib/peer";
import { bridge, hasBridge } from "../lib/platform";
import type { OutgoingMedia } from "./useRoom";

export type CaptureStatus = "idle" | "picking" | "starting" | "live";

export interface UseCapture {
  status: CaptureStatus;
  stream: MediaStream | null;
  // Webcam sobreposta à tela, quando ligada (no modo "só webcam" ela é o próprio stream).
  cameraTrack: MediaStreamTrack | null;
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
  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null);
  // Erro da webcam sobreposta, separado para não apagar avisos da captura.
  const [cameraError, setCameraError] = useState<string | null>(null);
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
    setCameraError(null);
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
        setError(settings.source === "camera" ? describeCameraError(err) : describeError(err));
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
      // Só webcam: não há tela para escolher.
      if (settings.source === "camera") return start(null);
      const listing = await listSources();
      if (listing.picker === "system") return start(null);
      setSources(listing.sources);
      setStatus("picking");
    } catch (err) {
      busy.current = false;
      setStatus("idle");
      setError(describeError(err));
    }
  }, [settings.source, start]);

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
    // A webcam principal mantém o "motion" do openCamera.
    if (settings.source === "screen") video.contentHint = settings.content;
    video
      .applyConstraints({
        width: { ideal: width, max: width },
        height: { ideal: height, max: height },
        frameRate: { ideal: settings.fps, max: settings.fps },
      })
      .catch((err: unknown) => console.warn("Falha ao aplicar resolução/FPS", err));
  }, [stream, settings.resolution, settings.fps, settings.content, settings.source]);

  // O áudio do sistema pode cair no meio da transmissão (helper do Windows): o vídeo
  // continua, mas o host precisa saber que está mudo.
  useEffect(() => {
    if (status !== "live" || !hasBridge()) return;
    return bridge().onSystemAudioStopped((reason) => {
      setError(`O áudio do sistema parou (${reason}); transmitindo só o vídeo.`);
    });
  }, [status]);

  // Webcam sobreposta: abre/fecha ao vivo conforme a opção, sem recapturar a tela.
  const wantsOverlay = status === "live" && settings.source === "screen" && settings.cameraOverlay;
  useEffect(() => {
    if (!wantsOverlay) return;
    let cancelled = false;
    let opened: MediaStreamTrack | null = null;
    openCamera(settings.cameraId, OVERLAY_CAPTURE)
      .then((track) => {
        if (cancelled) return track.stop();
        opened = track;
        // Câmera desconectada no meio da transmissão: desmarca a opção, senão ela
        // ficaria "ligada" sem câmera e sem como tentar de novo.
        track.addEventListener("ended", () => {
          setCameraTrack((t) => (t === track ? null : t));
          setCameraError("A webcam foi desconectada.");
          setSettings((prev) => ({ ...prev, cameraOverlay: false }));
        });
        setCameraError(null);
        setCameraTrack(track);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraError(describeCameraError(err));
        setSettings((prev) => ({ ...prev, cameraOverlay: false }));
      });
    return () => {
      cancelled = true;
      opened?.stop();
      setCameraTrack(null);
    };
  }, [wantsOverlay, settings.cameraId]);

  useEffect(() => stop, [stop]);

  const params = useMemo<SendParams>(
    () => ({
      maxBitrate: settings.bitrateMbps * 1_000_000,
      maxFramerate: settings.fps,
      degradation: settings.content === "motion" ? "maintain-framerate" : "maintain-resolution",
    }),
    [settings.bitrateMbps, settings.fps, settings.content],
  );
  const outgoing = useMemo<OutgoingMedia>(
    () => ({ stream, params, camera: cameraTrack, cameraLayout: settings.cameraLayout }),
    [stream, params, cameraTrack, settings.cameraLayout],
  );

  return {
    status,
    stream,
    cameraTrack,
    sources,
    settings,
    error: [error, cameraError].filter(Boolean).join(" ") || null,
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
