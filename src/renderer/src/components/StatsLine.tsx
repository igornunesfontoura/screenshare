import type { MediaStats } from "../lib/stats";

const LIMITATIONS: Record<string, string> = {
  cpu: "limitado por CPU",
  bandwidth: "limitado por banda",
};

export function StatsLine({ stats }: { stats: MediaStats | null }) {
  if (!stats) return null;

  const parts = [
    stats.width && stats.height ? `${stats.width}×${stats.height}` : null,
    stats.fps !== null ? `${Math.round(stats.fps)} fps` : null,
    stats.kbps !== null ? `${(stats.kbps / 1000).toFixed(1)} Mbps` : null,
    stats.codec,
    stats.hardware === null ? null : stats.hardware ? "HW" : "SW",
  ].filter(Boolean);

  const limitation = stats.limitation ? LIMITATIONS[stats.limitation] : undefined;
  const audioParts = [
    stats.audioLossPct !== null ? `perda ${stats.audioLossPct}%` : null,
    stats.audioConcealedPct !== null ? `${stats.audioConcealedPct}% reconstruído` : null,
  ].filter(Boolean);
  // Acima de ~2% o som começa a soar picotado/robotizado.
  const audioBad = (stats.audioLossPct ?? 0) > 2 || (stats.audioConcealedPct ?? 0) > 2;

  return (
    <span className="font-mono text-xs text-slate-400" title={stats.implementation ?? undefined}>
      {parts.join(" · ")}
      {limitation && <span className="ml-2 text-amber-300">{limitation}</span>}
      {audioParts.length > 0 && (
        <span className={`ml-2 ${audioBad ? "text-amber-300" : ""}`}>
          · áudio: {audioParts.join(" · ")}
        </span>
      )}
    </span>
  );
}
