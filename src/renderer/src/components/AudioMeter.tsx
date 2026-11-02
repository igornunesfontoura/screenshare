import { useAudioLevel } from "../hooks/useAudioLevel";

interface AudioMeterProps {
  stream: MediaStream | null;
  label: string;
  className?: string;
}

export function AudioMeter({ stream, label, className = "" }: AudioMeterProps) {
  const level = useAudioLevel(stream);
  const color = level > 0.9 ? "bg-red-400" : level > 0.7 ? "bg-amber-300" : "bg-emerald-400";

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className={`h-1.5 overflow-hidden rounded-full bg-white/10 ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-75 ${color}`}
        style={{ width: `${level * 100}%` }}
      />
    </div>
  );
}
