import { useEffect, useState } from "react";
import { Cpu, Radio } from "lucide-react";
import { Home } from "./components/Home";
import { RoomView } from "./components/RoomView";
import { useCapture } from "./hooks/useCapture";
import { useRoom } from "./hooks/useRoom";
import { getPlatformInfo, type PlatformInfo } from "./lib/platform";

function App() {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const capture = useCapture();
  const room = useRoom(capture.outgoing);
  const inRoom = room.session.status === "in-room";
  const stopCapture = capture.stop;

  // Sala encerrada (por nós, pelo servidor ou por erro) encerra a transmissão.
  useEffect(() => {
    if (!inRoom) stopCapture();
  }, [inRoom, stopCapture]);

  useEffect(() => {
    // Fora do Tauri (ex.: `npm run dev` no navegador) o invoke falha; ignoramos.
    getPlatformInfo().then(setPlatform).catch(() => setPlatform(null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Radio className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-semibold tracking-wide">
            Screen<span className="text-cyan-400">Share</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Cpu className="h-4 w-4" />
          {platform
            ? `${platform.os} · ${platform.arch} · ${platform.captureBackend}`
            : "modo navegador"}
        </div>
      </header>

      <main className="flex flex-1 overflow-y-auto p-6">
        {room.session.status === "in-room" ? (
          <RoomView session={room.session} room={room} capture={capture} />
        ) : (
          <Home
            session={room.session}
            error={room.error}
            onCreate={room.createRoom}
            onJoin={room.joinRoom}
            onCancel={room.leave}
          />
        )}
      </main>

      <footer className="border-t border-border px-6 py-3 text-xs text-slate-500">
        {platform ? `ScreenShare v${platform.version}` : "ScreenShare (navegador)"} · P2P via WebRTC
      </footer>
    </div>
  );
}

export default App;
