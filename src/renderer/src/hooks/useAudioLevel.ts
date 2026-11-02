import { useEffect, useState } from "react";

const UPDATE_MS = 66;
const FLOOR_DB = -60;

let sharedContext: AudioContext | null = null;

// Nível do áudio de um stream em 0..1 (escala em dB de -60 a 0), para medidores.
// Áudio remoto do WebRTC só chega ao WebAudio se também estiver tocando num <video>.
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) {
      setLevel(0);
      return;
    }

    sharedContext ??= new AudioContext();
    const context = sharedContext;
    void context.resume();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-8);
      setLevel(Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB)));
    }, UPDATE_MS);

    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [stream]);

  return level;
}
