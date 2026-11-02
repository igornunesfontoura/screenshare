import { Check, UserPlus, X } from "lucide-react";
import type { JoinRequest } from "../hooks/useRoom";

interface JoinRequestsProps {
  requests: JoinRequest[];
  onAdmit(peerId: string): void;
  onReject(peerId: string): void;
}

export function JoinRequests({ requests, onAdmit, onReject }: JoinRequestsProps) {
  if (!requests.length) return null;

  return (
    <section
      aria-label="Pedidos de entrada"
      className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4"
    >
      {requests.map((request) => (
        <div key={request.peerId} className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">
            <UserPlus className="h-4 w-4 text-amber-300" />
            <span className="font-medium text-slate-100">{request.name}</span>
            <span className="text-slate-400">quer entrar na sala</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReject(request.peerId)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
            >
              <X className="h-4 w-4" />
              Recusar
            </button>
            <button
              type="button"
              onClick={() => onAdmit(request.peerId)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-void transition hover:bg-emerald-400"
            >
              <Check className="h-4 w-4" />
              Aprovar
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
