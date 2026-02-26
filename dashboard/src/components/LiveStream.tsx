import { useRef, useEffect, useState } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const EVENT_DOT: Record<string, string> = {
  thought: "bg-ai",
  tool_call: "bg-kin",
  tool_use: "bg-kin",
  tool_result: "bg-kitsune",
  text: "bg-sumi-light",
  error: "bg-shu",
  iteration_start: "bg-matcha",
  iteration_end: "bg-matcha",
  iteration_summary: "bg-matcha",
  connected: "bg-fuji",
};

const EVENT_TEXT: Record<string, string> = {
  thought: "text-ai",
  tool_call: "text-kin",
  tool_use: "text-kin",
  tool_result: "text-kitsune",
  text: "text-sumi-light",
  error: "text-shu",
  iteration_start: "text-matcha",
  iteration_end: "text-matcha",
  iteration_summary: "text-matcha",
  connected: "text-fuji",
};

const HIDDEN_EVENTS = new Set(["step_start", "step_finish", "connected"]);

function FormatContent({ content }: { content: string }) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {}

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return (
      <div className="mt-1.5 ml-5 p-3 ink-inset rounded text-xs space-y-1 max-h-64 overflow-auto">
        {Object.entries(parsed).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="text-sumi-faint shrink-0 font-mono">{key}:</span>
            <span className="text-sumi whitespace-pre-wrap break-words">
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre className="mt-1.5 ml-5 p-3 ink-inset rounded text-xs text-sumi whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">
      {content}
    </pre>
  );
}

function EventRow({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);
  const data = typeof event.data === "object" ? event.data : {};
  const summary = data?.summary ?? (typeof event.data === "string" ? event.data : "");
  const content = data?.content;
  const hasContent = content && content !== summary && content.length > 0;

  return (
    <div className="ink-fade-in">
      <div
        className={`flex items-start gap-2.5 py-1 ${
          hasContent ? "cursor-pointer hover:bg-washi-dark/50 rounded px-2 -mx-2 transition-colors" : ""
        }`}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        {hasContent && (
          <span className={`text-sumi-faint shrink-0 transition-transform text-xs mt-[5px] ${expanded ? "rotate-90" : ""}`}>
            &#9656;
          </span>
        )}
        <span className={`ink-dot ${EVENT_DOT[event.type] ?? "bg-sumi-faint"}`} />
        <span className="text-sumi-faint shrink-0 font-mono text-xs">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
        <span className={`font-medium shrink-0 text-xs ${EVENT_TEXT[event.type] ?? "text-sumi-light"}`}>
          {event.type}
        </span>
        <span className="text-sumi truncate text-xs">{summary}</span>
      </div>
      {expanded && content && <FormatContent content={content} />}
    </div>
  );
}

export function LiveStream() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`;
  const { events, connected } = useWebSocket(wsUrl);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="kanji-accent text-base">流</span>
          <h2 className="section-heading">Live Stream</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-matcha" : "bg-shu"}`} />
          <span className={`text-xs font-medium ${connected ? "text-matcha" : "text-shu"}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto font-mono text-sm space-y-0.5">
        {events.length === 0 && (
          <p className="text-sumi-faint italic font-sans text-sm">Waiting for events...</p>
        )}
        {events
          .filter((e) => !HIDDEN_EVENTS.has(e.type))
          .map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
