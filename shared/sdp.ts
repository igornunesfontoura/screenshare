// Ajustes de SDP que a API do WebRTC não expõe diretamente.

const OPUS_HIGH_QUALITY = "stereo=1;sprop-stereo=1;maxaveragebitrate=256000";

// O Opus é negociado em mono e ~32 kbps por padrão; para filmes e música
// pedimos estéreo com bitrate alto em todas as linhas fmtp do Opus.
export function enableOpusStereo(sdp: string): string {
  const opusPayloads = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)].map((m) => m[1]);

  return opusPayloads.reduce((current, payload) => {
    const fmtp = new RegExp(`^(a=fmtp:${payload} )(.*)$`, "m");
    if (!fmtp.test(current)) return current;
    return current.replace(fmtp, (_line, prefix: string, params: string) => {
      const kept = params
        .split(";")
        .filter((param) => !/^(stereo|sprop-stereo|maxaveragebitrate)=/.test(param.trim()));
      return prefix + [...kept, OPUS_HIGH_QUALITY].join(";");
    });
  }, sdp);
}
