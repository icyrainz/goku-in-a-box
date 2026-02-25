import { useRef, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const EVENT_COLORS: Record<string, string> = {
  thought: "text-blue-400",
  tool_call: "text-yellow-400",
  tool_use: "text-yellow-400",
  tool_result: "text-orange-400",
  text: "text-gray-300",
  error: "text-red-400",
  iteration_start: "text-green-400",
  iteration_end: "text-green-400",
  connected: "text-purple-400",
};

const HIDDEN_EVENTS = new Set(["step_start", "step_finish", "connected"]);

export function LiveStream() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`;
  const { events, connected } = useWebSocket(wsUrl);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Live Stream</h2>
        <span className={`text-xs ${connected ? "text-green-400" : "text-red-400"}`}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs space-y-1">
        {events.length === 0 && (
          <p className="text-gray-600 italic">Waiting for events...</p>
        )}
        {events.filter((e) => !HIDDEN_EVENTS.has(e.type)).map((event, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-600 shrink-0">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span className={`font-semibold shrink-0 ${EVENT_COLORS[event.type] ?? "text-gray-400"}`}>
              [{event.type}]
            </span>
            <span className="text-gray-300 truncate">
              {event.data == null
                ? ""
                : typeof event.data === "object"
                  ? (event.data as any).summary ?? JSON.stringify(event.data)
                  : String(event.data)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
