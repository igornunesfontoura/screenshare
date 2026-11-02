import { useEffect, useRef } from "react";

interface VideoViewProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}

export function VideoView({ stream, muted = false, className = "" }: VideoViewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full bg-black object-contain ${className}`}
    />
  );
}
