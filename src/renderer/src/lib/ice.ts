// STUN público do Google por padrão; TURN opcional via .env para NATs simétricos.
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }

  return servers;
}
