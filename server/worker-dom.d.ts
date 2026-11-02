// shared/protocol.ts usa este tipo do DOM, que os tipos do Workers não trazem.
// O servidor só repassa o candidato ICE, sem olhar os campos.
interface RTCIceCandidateInit {
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
  usernameFragment?: string | null;
}

// rooms.ts limpa timers opcionais (como no DOM e no Node); o runtime aceita undefined.
declare function clearTimeout(timeoutId: number | undefined): void;
