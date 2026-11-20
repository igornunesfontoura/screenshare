// Webcam: como fonte principal ("só webcam") ou sobreposta à tela. Na sobreposição
// ela vai numa trilha de vídeo própria, leve, e cada viewer a desenha por cima da
// tela; o host escolhe canto e tamanho (CameraLayout), enviados pelo canal de controle.

export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type OverlaySize = "small" | "medium" | "large";

export interface CameraLayout {
  corner: OverlayCorner;
  size: OverlaySize;
}

export const DEFAULT_LAYOUT: CameraLayout = { corner: "bottom-right", size: "medium" };

export const OVERLAY_CORNERS: { id: OverlayCorner; label: string }[] = [
  { id: "top-left", label: "Superior esquerdo" },
  { id: "top-right", label: "Superior direito" },
  { id: "bottom-left", label: "Inferior esquerdo" },
  { id: "bottom-right", label: "Inferior direito" },
];

export const OVERLAY_SIZES: { id: OverlaySize; label: string; width: string }[] = [
  { id: "small", label: "P", width: "18%" },
  { id: "medium", label: "M", width: "25%" },
  { id: "large", label: "G", width: "34%" },
];

// Câmera sobreposta: 720p30 basta para um quadro pequeno e mantém o upload baixo.
export const OVERLAY_CAPTURE = { width: 1280, height: 720, fps: 30 } as const;
export const OVERLAY_SEND = { maxBitrate: 1_500_000, maxFramerate: 30 } as const;

export function isCameraLayout(value: unknown): value is CameraLayout {
  if (typeof value !== "object" || value === null) return false;
  const { corner, size } = value as Record<string, unknown>;
  return OVERLAY_CORNERS.some((c) => c.id === corner) && OVERLAY_SIZES.some((s) => s.id === size);
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

// Os nomes só aparecem depois de a câmera ter sido aberta uma vez (permissão).
export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }));
}

export async function openCamera(
  deviceId: string | null,
  { width, height, fps }: { width: number; height: number; fps: number },
): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: fps, max: fps },
    },
    audio: false,
  });
  const [track] = stream.getVideoTracks();
  // Rosto e movimento: fluidez antes de nitidez.
  track.contentHint = "motion";
  return track;
}

export function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Acesso à webcam negado.";
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError") return "Nenhuma webcam encontrada.";
    if (err.name === "NotReadableError") return "A webcam está em uso por outro app.";
  }
  return `Falha ao abrir a webcam: ${err instanceof Error ? err.message : String(err)}`;
}
