const WINDOW_MS = 60_000;
const MAX_JOINS_PER_WINDOW = 20;

// Janela fixa por IP para tentativas de entrar em sala.
export class JoinRateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = MAX_JOINS_PER_WINDOW, windowMs = WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(ip: string, now = Date.now()): boolean {
    const entry = this.hits.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  prune(now = Date.now()): void {
    for (const [ip, entry] of this.hits) {
      if (now >= entry.resetAt) this.hits.delete(ip);
    }
  }
}
