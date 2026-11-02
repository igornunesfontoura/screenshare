import type { PeerStatus } from "../hooks/useRoom";

const LABELS: Record<RTCPeerConnectionState, { text: string; className: string }> = {
  new: { text: "Negociando", className: "bg-slate-500/15 text-slate-300" },
  connecting: { text: "Conectando", className: "bg-amber-500/15 text-amber-300" },
  connected: { text: "P2P conectado", className: "bg-emerald-500/15 text-emerald-300" },
  disconnected: { text: "Instável", className: "bg-amber-500/15 text-amber-300" },
  failed: { text: "Falhou", className: "bg-red-500/15 text-red-300" },
  closed: { text: "Fechado", className: "bg-slate-500/15 text-slate-400" },
};

export function ConnectionBadge({ status }: { status: PeerStatus }) {
  const label = LABELS[status.state];
  return (
    <div className="flex items-center gap-3 text-xs">
      {status.rtt !== null && status.state === "connected" && (
        <span className="font-mono text-slate-400">{status.rtt} ms</span>
      )}
      <span className={`rounded-full px-2.5 py-1 font-medium ${label.className}`}>
        {label.text}
      </span>
    </div>
  );
}
