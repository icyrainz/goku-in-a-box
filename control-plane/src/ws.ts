interface WsLike {
  send(data: string): void;
}

export class WsBroadcaster {
  private clients = new Set<WsLike>();

  get clientCount() {
    return this.clients.size;
  }

  register(ws: WsLike) {
    this.clients.add(ws);
  }

  remove(ws: WsLike) {
    this.clients.delete(ws);
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
}
