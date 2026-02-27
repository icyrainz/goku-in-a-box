interface WsLike {
  send(data: string): void;
}

const PING_INTERVAL_MS = 15_000;

export class WsBroadcaster {
  private clients = new Set<WsLike>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  get clientCount() {
    return this.clients.size;
  }

  register(ws: WsLike) {
    this.clients.add(ws);
    if (!this.pingTimer) this.startPing();
  }

  remove(ws: WsLike) {
    this.clients.delete(ws);
    if (this.clients.size === 0) this.stopPing();
  }

  broadcast(event: { type: string; data: unknown; timestamp?: string }) {
    const message = JSON.stringify({
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    });

    for (const ws of this.clients) {
      try {
        ws.send(message);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.broadcast({ type: "ping", data: null });
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
