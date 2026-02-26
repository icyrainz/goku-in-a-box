import { describe, it, expect, beforeEach } from "bun:test";
import { WsBroadcaster } from "./ws";

describe("WsBroadcaster", () => {
  let broadcaster: WsBroadcaster;

  beforeEach(() => {
    broadcaster = new WsBroadcaster();
  });

  it("starts with zero clients", () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  it("registers and removes clients", () => {
    const fakeWs = { send: () => {}, close: () => {} };
    broadcaster.register(fakeWs as any);
    expect(broadcaster.clientCount).toBe(1);
    broadcaster.remove(fakeWs as any);
    expect(broadcaster.clientCount).toBe(0);
  });

  it("broadcasts to all connected clients", () => {
    const messages: string[] = [];
    const fakeWs1 = { send: (m: string) => messages.push(m), close: () => {} };
    const fakeWs2 = { send: (m: string) => messages.push(m), close: () => {} };
    broadcaster.register(fakeWs1 as any);
    broadcaster.register(fakeWs2 as any);

    broadcaster.broadcast({ type: "test", data: { foo: "bar" } });

    expect(messages).toHaveLength(2);
    const parsed = JSON.parse(messages[0]!);
    expect(parsed.type).toBe("test");
    expect(parsed.data.foo).toBe("bar");
    expect(parsed.timestamp).toBeDefined();
  });

  it("removes clients that throw on send", () => {
    const fakeWs = {
      send: () => { throw new Error("disconnected"); },
      close: () => {},
    };
    broadcaster.register(fakeWs as any);
    broadcaster.broadcast({ type: "test", data: {} });
    expect(broadcaster.clientCount).toBe(0);
  });
});
