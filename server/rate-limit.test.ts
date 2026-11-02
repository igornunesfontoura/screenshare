import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JoinRateLimiter } from "./rate-limit.ts";

describe("JoinRateLimiter", () => {
  it("bloqueia acima do limite e libera na próxima janela", () => {
    const limiter = new JoinRateLimiter(3, 1000);
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow("a", 0)), [true, true, true, false]);
    assert.equal(limiter.allow("b", 0), true);
    assert.equal(limiter.allow("a", 1000), true);
  });
});
