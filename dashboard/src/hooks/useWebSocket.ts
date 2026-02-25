import { useEffect, useRef, useCallback, useState } from "react";

type WsEvent = { type: string; data: unknown; timestamp: string };

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent;
        setEvents((prev) => [...prev.slice(-500), event]);
      } catch {}
    };

    return () => ws.close();
  }, [url]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
