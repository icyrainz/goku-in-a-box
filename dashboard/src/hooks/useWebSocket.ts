import { useEffect, useCallback, useState, useRef } from "react";

type WsEvent = { type: string; data: unknown; timestamp: string };

const HEARTBEAT_TIMEOUT_MS = 20_000; // server pings every 15s, allow 5s grace
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HIDDEN_WS_EVENTS = new Set(["ping"]);

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_BASE_MS;

    function resetHeartbeat() {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        ws?.close();
      }, HEARTBEAT_TIMEOUT_MS);
    }

    function connect() {
      if (disposed) return;

      ws = new WebSocket(url);

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        reconnectDelay = RECONNECT_BASE_MS;
        resetHeartbeat();
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        if (heartbeatTimer) clearTimeout(heartbeatTimer);

        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      };

      ws.onmessage = (e) => {
        if (disposed) return;
        resetHeartbeat();
        try {
          const event = JSON.parse(e.data) as WsEvent;
          if (HIDDEN_WS_EVENTS.has(event.type)) return;
          if (event.type === "session_start") {
            setEvents([event]);
          } else {
            setEvents((prev) => [...prev.slice(-500), event]);
          }
        } catch {}
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      ws?.close();
    };
  }, [url]);

  const clearEvents = useCallback(() => { seededRef.current = false; setEvents([]); }, []);
  const seedEvents = useCallback((seed: WsEvent[]) => {
    if (seededRef.current) return;
    seededRef.current = true;
    setEvents((prev) => prev.length === 0 ? seed : [...seed, ...prev]);
  }, []);

  return { events, connected, clearEvents, seedEvents };
}
