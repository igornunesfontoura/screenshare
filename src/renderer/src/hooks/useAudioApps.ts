import { useCallback, useEffect, useMemo, useState } from "react";
import type { AudioApp } from "../../../../shared/platform.ts";
import { bridge, hasBridge } from "../lib/platform";
import { usePersistentState } from "./usePersistentState";

const POLL_MS = 3000;

export interface AudioAppEntry extends AudioApp {
  blocked: boolean;
  // Tem sessão/stream de áudio agora (bloqueados continuam listados mesmo sem tocar).
  present: boolean;
}

export interface UseAudioApps {
  // false: a plataforma só captura o sistema inteiro (sem filtro por app).
  supported: boolean;
  apps: AudioAppEntry[];
  toggle(app: AudioApp): void;
}

// Apps com áudio no host e quais deles ficam fora da transmissão. O padrão é
// transmitir tudo: um app novo entra sozinho até o usuário bloqueá-lo.
export function useAudioApps(active: boolean): UseAudioApps {
  const [blocked, setBlocked] = usePersistentState<AudioApp[]>("screenshare:blocked-audio-apps", () => []);
  const [present, setPresent] = useState<AudioApp[]>([]);
  const [supported, setSupported] = useState(true);

  // O main precisa da lista antes de a captura começar e a cada mudança.
  useEffect(() => {
    if (hasBridge()) void bridge().setBlockedAudioApps(blocked.map((app) => app.id));
  }, [blocked]);

  useEffect(() => {
    if (!active || !hasBridge()) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const listing = await bridge().listAudioApps();
        if (cancelled) return;
        setSupported(listing.supported);
        setPresent(listing.apps);
      } catch (err) {
        console.warn("Falha ao listar apps com áudio", err);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const toggle = useCallback(
    (app: AudioApp) => {
      const isBlocked = blocked.some((b) => b.id === app.id);
      setBlocked(isBlocked ? blocked.filter((b) => b.id !== app.id) : [...blocked, { id: app.id, name: app.name }]);
    },
    [blocked, setBlocked],
  );

  const apps = useMemo(() => {
    const entries = new Map<string, AudioAppEntry>();
    for (const app of present) entries.set(app.id, { ...app, blocked: false, present: true });
    for (const app of blocked) {
      const entry = entries.get(app.id);
      entries.set(app.id, entry ? { ...entry, blocked: true } : { ...app, blocked: true, present: false });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [present, blocked]);

  return { supported, apps, toggle };
}
