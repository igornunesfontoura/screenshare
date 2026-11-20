import { useEffect, useRef } from "react";
import { OVERLAY_SIZES, type CameraLayout, type OverlayCorner } from "../lib/camera";

const CORNER_CLASSES: Record<OverlayCorner, string> = {
  "top-left": "top-3 left-3",
  "top-right": "top-3 right-3",
  "bottom-left": "bottom-3 left-3",
  "bottom-right": "bottom-3 right-3",
};

// Webcam desenhada por cima da tela (prévia do host e player do viewer). O pai
// precisa ser `relative`.
export function CameraOverlay({ track, layout }: { track: MediaStreamTrack; layout: CameraLayout }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);

  const width = OVERLAY_SIZES.find((s) => s.id === layout.size)?.width ?? "25%";

  return (
    <div
      style={{ width }}
      className={`pointer-events-none absolute aspect-video overflow-hidden rounded-lg border border-white/20 bg-black shadow-lg shadow-black/50 ${CORNER_CLASSES[layout.corner]}`}
    >
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />
    </div>
  );
}
