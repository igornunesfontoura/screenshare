// Seleção da fonte de vídeo para o getDisplayMedia do renderer.

import { desktopCapturer, session, type DesktopCapturerSource } from "electron";
import type {
  CaptureRequest,
  CaptureSource,
  PreparedCapture,
  SourceListing,
} from "../../../shared/platform.ts";
import { winHelperAvailable } from "./win-audio.ts";

const THUMBNAIL_SIZE = { width: 320, height: 180 };
// Um prepareCapture só autoriza o getDisplayMedia que vem logo em seguida.
const REQUEST_TTL_MS = 10_000;

let listedSources = new Map<string, DesktopCapturerSource>();
let pendingRequest: (CaptureRequest & { expiresAt: number }) | null = null;

// No Wayland o getSources abre o seletor do portal e devolve só a fonte escolhida.
function usesSystemPicker(): boolean {
  return process.platform === "linux" && Boolean(process.env.WAYLAND_DISPLAY);
}

export async function listCaptureSources(): Promise<SourceListing> {
  if (usesSystemPicker()) return { picker: "system" };

  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: THUMBNAIL_SIZE,
  });
  listedSources = new Map(sources.map((source) => [source.id, source]));
  return {
    picker: "app",
    sources: sources.map(
      (source): CaptureSource => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: source.thumbnail.toDataURL(),
      }),
    ),
  };
}

export function prepareCapture(input: unknown): PreparedCapture {
  const request = parseRequest(input);
  pendingRequest = { ...request, expiresAt: Date.now() + REQUEST_TTL_MS };
  return { audioViaDisplayMedia: request.systemAudio && loopbackViaChromium() };
}

function parseRequest(input: unknown): CaptureRequest {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  return {
    sourceId: typeof value.sourceId === "string" ? value.sourceId : null,
    systemAudio: value.systemAudio === true,
  };
}

// Windows sem o helper de áudio por app: loopback do sistema inteiro pelo Chromium.
function loopbackViaChromium(): boolean {
  return process.platform === "win32" && !winHelperAvailable();
}

export function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const request = pendingRequest;
    pendingRequest = null;
    // Só atende pedidos recentes que passaram pelo fluxo do app (prepareCapture).
    if (!request || Date.now() > request.expiresAt) return callback({});

    try {
      const source = usesSystemPicker()
        ? (await desktopCapturer.getSources({ types: ["screen", "window"] }))[0]
        : request.sourceId
          ? listedSources.get(request.sourceId)
          : undefined;
      if (!source) return callback({});

      callback({
        video: source,
        audio: request.systemAudio && loopbackViaChromium() ? "loopback" : undefined,
      });
    } catch (err) {
      console.error("Falha ao obter a fonte de captura", err);
      callback({});
    }
  });
}
