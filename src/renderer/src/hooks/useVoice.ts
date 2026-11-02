import { useCallback, useEffect, useState } from "react";
import { PTT_CODE, openMicrophone, type VoiceMode } from "../lib/voice";

export interface UseVoice {
  mode: VoiceMode;
  setMode(mode: VoiceMode): void;
  // Trilha do microfone enviada à sala (null quando a voz está desligada).
  micTrack: MediaStreamTrack | null;
  micStream: MediaStream | null;
  transmitting: boolean;
  error: string | null;
}

// Microfone com push-to-talk (segurar V) ou aberto. O atalho só funciona com a
// janela em foco: o globalShortcut do Electron não informa quando a tecla é solta.
export function useVoice(active: boolean): UseVoice {
  const [mode, setModeState] = useState<VoiceMode>("off");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = useCallback((next: VoiceMode) => {
    setError(null);
    setModeState(next);
  }, []);

  // O microfone só fica aberto com a voz ligada e dentro de uma sala.
  const wantsMic = active && mode !== "off";
  useEffect(() => {
    if (!wantsMic) return;
    let cancelled = false;
    let opened: MediaStream | null = null;
    openMicrophone()
      .then((stream) => {
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        opened = stream;
        setMicStream(stream);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? `Microfone indisponível: ${err.message}` : "Microfone indisponível.");
        setModeState("off");
      });
    return () => {
      cancelled = true;
      for (const track of opened?.getTracks() ?? []) track.stop();
      setMicStream(null);
    };
  }, [wantsMic]);

  useEffect(() => {
    if (mode !== "ptt") return;
    const typing = (event: KeyboardEvent) =>
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]");
    const down = (event: KeyboardEvent) => {
      if (event.code === PTT_CODE && !typing(event)) setPressed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === PTT_CODE) setPressed(false);
    };
    // Perder o foco com a tecla segura não pode deixar o microfone aberto.
    const release = () => setPressed(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      setPressed(false);
    };
  }, [mode]);

  const transmitting = Boolean(micStream) && (mode === "open" || (mode === "ptt" && pressed));
  const micTrack = micStream?.getAudioTracks()[0] ?? null;

  // Fora do push-to-talk a trilha segue negociada, mas envia silêncio.
  useEffect(() => {
    if (micTrack) micTrack.enabled = transmitting;
  }, [micTrack, transmitting]);

  return { mode, setMode, micTrack, micStream, transmitting, error };
}
