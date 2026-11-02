import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enableOpusStereo } from "./sdp.ts";

const SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "",
].join("\r\n");

describe("enableOpusStereo", () => {
  it("adiciona estéreo e bitrate só na linha fmtp do Opus", () => {
    const out = enableOpusStereo(SDP);
    assert.match(
      out,
      /a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;maxaveragebitrate=256000;usedtx=0;useinbandfec=1\r\n/,
    );
    assert.match(out, /a=fmtp:63 111\/111\r\n/);
  });

  it("é idempotente e substitui valores existentes", () => {
    const once = enableOpusStereo(SDP.replace("useinbandfec=1", "useinbandfec=1;stereo=0;usedtx=1"));
    assert.equal(enableOpusStereo(once), once);
    assert.doesNotMatch(once, /stereo=0/);
    assert.doesNotMatch(once, /usedtx=1/);
  });

  it("não altera SDP sem Opus", () => {
    const video = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    assert.equal(enableOpusStereo(video), video);
  });
});
