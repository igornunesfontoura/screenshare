import { useEffect, useState } from "react";
import { Camera, MonitorUp } from "lucide-react";
import type { UseCapture } from "../hooks/useCapture";
import { OVERLAY_CORNERS, OVERLAY_SIZES, listCameras, type CameraDevice } from "../lib/camera";
import type { VideoSource } from "../lib/capture";

const SOURCES: { id: VideoSource; label: string; icon: typeof MonitorUp }[] = [
  { id: "screen", label: "Tela", icon: MonitorUp },
  { id: "camera", label: "Webcam", icon: Camera },
];

// Webcams conectadas; a lista acompanha câmeras plugadas/removidas e é relida a
// cada `refresh` (os nomes só aparecem depois de a câmera abrir uma vez).
function useCameras(refresh: unknown): CameraDevice[] {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  useEffect(() => {
    const refresh = () => {
      listCameras()
        .then(setCameras)
        .catch((err: unknown) => console.warn("Falha ao listar webcams", err));
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [refresh]);
  return cameras;
}

// Fonte da transmissão (tela ou só webcam) e a webcam sobreposta à tela.
// A fonte é fixa durante a transmissão; a sobreposição, o canto e o tamanho mudam ao vivo.
export function CameraSettings({ capture }: { capture: UseCapture }) {
  const { settings, updateSettings, status } = capture;
  const live = status === "live";
  const locked = live || status === "starting" || status === "picking";
  const cameras = useCameras(capture.cameraTrack ?? status);

  // Câmera escolhida foi desconectada: volta ao padrão em vez de falhar com o id antigo.
  // Lista vazia (antes da permissão os ids vêm vazios) não conta.
  const staleCamera =
    settings.cameraId !== null && cameras.length > 0 && !cameras.some((c) => c.deviceId === settings.cameraId);
  useEffect(() => {
    if (staleCamera) updateSettings({ cameraId: null });
  }, [staleCamera, updateSettings]);

  const usesCamera = settings.source === "camera" || settings.cameraOverlay;
  const cameraValue = cameras.some((c) => c.deviceId === settings.cameraId) ? settings.cameraId! : "";

  return (
    <div className="mb-4 space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm text-slate-400">Fonte</legend>
        <div className="flex gap-2">
          {SOURCES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={locked}
              onClick={() => updateSettings({ source: id })}
              aria-pressed={settings.source === id}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-emerald-400 aria-pressed:bg-emerald-400/5 aria-pressed:text-emerald-300"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {settings.source === "screen" && (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.cameraOverlay}
            onChange={(e) => updateSettings({ cameraOverlay: e.currentTarget.checked })}
            className="h-4 w-4 accent-emerald-400"
          />
          <span className="text-slate-300">Mostrar webcam por cima da tela</span>
        </label>
      )}

      {usesCamera && (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-slate-400">Webcam</span>
            <select
              value={cameraValue}
              // No modo só webcam a câmera é o vídeo principal: trocar exige recomeçar.
              disabled={settings.source === "camera" && locked}
              onChange={(e) => updateSettings({ cameraId: e.currentTarget.value || null })}
              className="w-full rounded-lg border border-border bg-void px-3 py-2 outline-none focus:border-cyan-400 disabled:opacity-50"
            >
              <option value="">Padrão do sistema</option>
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </select>
          </label>

          {settings.source === "screen" && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-slate-400">Canto</legend>
                <div className="grid w-28 grid-cols-2 gap-1.5">
                  {OVERLAY_CORNERS.map((corner) => (
                    <button
                      key={corner.id}
                      type="button"
                      aria-label={corner.label}
                      title={corner.label}
                      aria-pressed={settings.cameraLayout.corner === corner.id}
                      onClick={() => updateSettings({ cameraLayout: { ...settings.cameraLayout, corner: corner.id } })}
                      className="h-8 rounded-md border border-border transition hover:border-slate-500 aria-pressed:border-cyan-400 aria-pressed:bg-cyan-400/20"
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-slate-400">Tamanho</legend>
                <div className="flex gap-2">
                  {OVERLAY_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      aria-pressed={settings.cameraLayout.size === size.id}
                      onClick={() => updateSettings({ cameraLayout: { ...settings.cameraLayout, size: size.id } })}
                      className="w-10 rounded-lg border border-border py-2 transition aria-pressed:border-cyan-400 aria-pressed:text-cyan-300"
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>
      )}
    </div>
  );
}
