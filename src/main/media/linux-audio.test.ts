import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planLinks } from "./linux-audio.ts";

const node = (id: number, props: Record<string, unknown>) => ({
  id,
  type: "PipeWire:Interface:Node",
  info: { props },
});
const port = (id: number, nodeId: number, direction: string, channel: string) => ({
  id,
  type: "PipeWire:Interface:Port",
  info: { direction, props: { "node.id": nodeId, "audio.channel": channel } },
});
const link = (output: number, input: number) => ({
  id: 9000 + output,
  type: "PipeWire:Interface:Link",
  info: { "output-port-id": output, "input-port-id": input },
});
const playback = (id: number, props: Record<string, unknown> = {}) =>
  node(id, { "media.class": "Stream/Output/Audio", ...props });

const SINK = [
  node(1, { "node.name": "screenshare_capture", "media.class": "Audio/Sink" }),
  port(10, 1, "input", "FL"),
  port(11, 1, "input", "FR"),
];
const OWN = { pids: new Set([42]), appName: "ScreenShare" };

describe("planLinks", () => {
  it("liga streams de outros apps canal a canal e ignora os do próprio app", () => {
    const objects = [
      ...SINK,
      playback(2, { "application.process.id": 500 }),
      port(20, 2, "output", "FL"),
      port(21, 2, "output", "FR"),
      playback(3, { "application.process.id": 42 }),
      port(30, 3, "output", "FL"),
    ];
    assert.deepEqual(planLinks(objects, OWN), { add: [[20, 10], [21, 11]], remove: [] });
  });

  it("reconhece o próprio app pelo nome quando o PID não bate (Flatpak)", () => {
    const objects = [...SINK, playback(3, { "application.name": "screenshare" }), port(30, 3, "output", "FL")];
    assert.deepEqual(planLinks(objects, OWN).add, []);
  });

  it("mapeia 5.1 para estéreo: central e LFE nos dois lados, traseiros no lado certo", () => {
    const objects = [
      ...SINK,
      playback(4),
      port(40, 4, "output", "FC"),
      port(41, 4, "output", "LFE"),
      port(42, 4, "output", "RL"),
      port(43, 4, "output", "RR"),
    ];
    assert.deepEqual(planLinks(objects, OWN).add, [
      [40, 10],
      [40, 11],
      [41, 10],
      [41, 11],
      [42, 10],
      [43, 11],
    ]);
  });

  it("stream mono vai para os dois canais e links existentes não se repetem", () => {
    const objects = [...SINK, playback(5), port(50, 5, "output", "MONO"), link(50, 10)];
    assert.deepEqual(planLinks(objects, OWN).add, [[50, 11]]);
  });

  it("remove links que levam o áudio do próprio app ao sink", () => {
    const objects = [
      ...SINK,
      playback(3, { "application.process.id": 42 }),
      port(30, 3, "output", "FL"),
      link(30, 10),
    ];
    assert.deepEqual(planLinks(objects, OWN), { add: [], remove: [[30, 10]] });
  });

  it("ignora gravações e não faz nada sem o sink de captura", () => {
    const input = [node(6, { "media.class": "Stream/Input/Audio" }), port(60, 6, "output", "FL")];
    assert.deepEqual(planLinks([...SINK, ...input], OWN), { add: [], remove: [] });
    assert.deepEqual(planLinks(input, OWN), { add: [], remove: [] });
  });
});
