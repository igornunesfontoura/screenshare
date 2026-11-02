import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inviteLink, parseInvite } from "./invite.ts";

describe("convite", () => {
  it("gera link https a partir de wss e http a partir de ws", () => {
    assert.equal(
      inviteLink("wss://sinal.exemplo.workers.dev", "012345"),
      "https://sinal.exemplo.workers.dev/j/012345",
    );
    assert.equal(inviteLink("ws://localhost:8787/", "123456"), "http://localhost:8787/j/123456");
    assert.equal(inviteLink("wss://exemplo.com/sinal/", "123456"), "https://exemplo.com/sinal/j/123456");
  });

  it("não gera link para endereço inválido", () => {
    assert.equal(inviteLink("isso não é url", "123456"), null);
    assert.equal(inviteLink("https://exemplo.com", "123456"), null);
    assert.equal(inviteLink("wss://exemplo.com/ws?token=abc", "123456"), null);
    assert.equal(inviteLink("wss://user:senha@exemplo.com", "123456"), null);
  });

  it("lê o link de volta, mesmo no meio de um texto", () => {
    assert.deepEqual(parseInvite("entra aí: https://sinal.exemplo.workers.dev/j/012345 valeu"), {
      serverUrl: "wss://sinal.exemplo.workers.dev",
      code: "012345",
    });
    assert.deepEqual(parseInvite("http://localhost:8787/j/123456/"), {
      serverUrl: "ws://localhost:8787",
      code: "123456",
    });
    assert.deepEqual(parseInvite("https://exemplo.com/sinal/j/123456"), {
      serverUrl: "wss://exemplo.com/sinal",
      code: "123456",
    });
  });

  it("ida e volta preserva servidor e código", () => {
    const link = inviteLink("wss://exemplo.com:8443/ws", "987654")!;
    assert.deepEqual(parseInvite(link), { serverUrl: "wss://exemplo.com:8443/ws", code: "987654" });
  });

  it("ignora texto que não é convite", () => {
    assert.equal(parseInvite("123456"), null);
    assert.equal(parseInvite("https://exemplo.com/j/12345"), null);
    assert.equal(parseInvite("https://exemplo.com/sala/123456"), null);
  });
});
