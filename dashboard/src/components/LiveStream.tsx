import { useRef, useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "../hooks/useWebSocket";
import { fetchJson } from "../api/client";

/* ── Event type styling maps ── */

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
  session_start: "bg-fuji",
  connected: "bg-fuji",
};

const BADGE_STYLE: Record<string, string> = {
  thought: "text-ai bg-ai/10 border-ai/20",
  tool_call: "text-kin bg-kin/10 border-kin/20",
  tool_use: "text-kin bg-kin/10 border-kin/20",
  tool_result: "text-kitsune bg-kitsune/10 border-kitsune/20",
  text: "text-sumi-light bg-sumi-light/10 border-sumi-light/15",
  error: "text-shu bg-shu/10 border-shu/20",
  iteration_start: "text-matcha bg-matcha/10 border-matcha/20",
  iteration_end: "text-matcha bg-matcha/10 border-matcha/20",
  iteration_summary: "text-matcha bg-matcha/10 border-matcha/20",
  session_start: "text-fuji bg-fuji/10 border-fuji/20",
  connected: "text-fuji bg-fuji/10 border-fuji/20",
};

const ACCENT_BORDER: Record<string, string> = {
  thought: "border-ai/30",
  tool_call: "border-kin/30",
  tool_use: "border-kin/30",
  tool_result: "border-kitsune/30",
  text: "border-sumi-light/20",
  error: "border-shu/30",
  iteration_start: "border-matcha/30",
  iteration_end: "border-matcha/30",
  iteration_summary: "border-matcha/30",
  session_start: "border-fuji/30",
  connected: "border-fuji/30",
};

const TOOL_BADGE: Record<string, string> = {
  read: "text-ai bg-ai/10 border-ai/20",
  write: "text-shu bg-shu/10 border-shu/20",
  edit: "text-kitsune bg-kitsune/10 border-kitsune/20",
  bash: "text-fuji bg-fuji/10 border-fuji/20",
};

function getToolName(summary: string): string | null {
  const match = summary.match(/^(\w+?)[\s:]/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return name in TOOL_BADGE ? name : null;
}

const HIDDEN_EVENTS = new Set(["step_start", "step_finish", "connected", "iteration_summary", "ping"]);

/* ── Linkify URLs in text ── */

const URL_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ai hover:text-ai-light underline decoration-ai/30 hover:decoration-ai/60 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

/* ── Expanded content formatter ── */

function FormatContent({ content, type }: { content: string; type: string }) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {}

  const accent = ACCENT_BORDER[type] ?? "border-sumi-faint/20";

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return (
      <div className={`mt-1 ml-6 pl-3 border-l-2 ${accent}`}>
        <div className="p-3 ink-inset rounded text-xs space-y-1 max-h-64 overflow-auto">
          {Object.entries(parsed).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-sumi-faint shrink-0 font-mono">{key}:</span>
              <Linkify
                text={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                className="text-sumi whitespace-pre-wrap break-words"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`mt-1 ml-6 pl-3 border-l-2 ${accent}`}>
      <pre className="p-3 ink-inset rounded text-xs text-sumi whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">
        <Linkify text={content} />
      </pre>
    </div>
  );
}

/* ── Iteration divider ── */

function IterationDivider({ event, summary }: { event: any; summary?: string }) {
  const data = typeof event.data === "object" ? event.data : {};
  const iterationId = data?.iterationId ?? data?.iteration_id;
  const isStart = event.type === "iteration_start";

  return (
    <div className="my-1">
      <div className="flex items-center gap-3 py-2">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-matcha/25 to-transparent" />
        <span className="text-[10px] font-mono text-matcha/60 tracking-widest uppercase shrink-0">
          {isStart ? `iteration ${iterationId ?? ""}` : `end ${iterationId ?? ""}`}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-matcha/25 to-transparent" />
      </div>
      {!isStart && summary && (
        <p className="text-[11px] text-sumi-faint text-center italic px-4 -mt-1 mb-1">{summary}</p>
      )}
    </div>
  );
}

/* ── Single event row ── */

function EventRow({ event, iterationSummary }: { event: any; iterationSummary?: string }) {
  const [expanded, setExpanded] = useState(false);
  const data = typeof event.data === "object" ? event.data : {};
  const summary = data?.summary ?? (typeof event.data === "string" ? event.data : "");
  const content = data?.content;
  const hasContent = content && content !== summary && content.length > 0;

  // Iteration lifecycle events get a divider instead of a normal row
  if (event.type === "iteration_start" || event.type === "iteration_end") {
    return <IterationDivider event={event} summary={event.type === "iteration_end" ? iterationSummary : undefined} />;
  }

  const badge = BADGE_STYLE[event.type] ?? "text-sumi-light bg-sumi-light/10 border-sumi-light/15";
  const toolName = event.type === "tool_use" ? getToolName(summary) : null;
  const toolBadge = toolName ? TOOL_BADGE[toolName] : null;

  return (
    <div className="ink-fade-in">
      <div
        className={`flex items-start gap-2 py-[5px] group ${
          hasContent ? "cursor-pointer hover:bg-washi-dark/40 rounded-md px-2 -mx-2 transition-colors" : ""
        }`}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        {/* Dot */}
        <span className={`ink-dot ${EVENT_DOT[event.type] ?? "bg-sumi-faint"}`} />

        {/* Time — fixed width for alignment */}
        <span className="text-sumi-faint shrink-0 font-mono text-[11px] w-[72px]">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>

        {/* Type badge */}
        <span
          className={`shrink-0 text-[10px] font-semibold tracking-wide px-1.5 py-px rounded border leading-tight ${badge}`}
        >
          {event.type}
        </span>

        {/* Tool name sub-badge — fixed width so summary text aligns */}
        {toolBadge && (
          <span
            className={`shrink-0 w-[42px] text-center text-[10px] font-semibold tracking-wide py-px rounded border leading-tight ${toolBadge}`}
          >
            {toolName}
          </span>
        )}

        {/* Summary */}
        <Linkify text={summary} className="text-sumi truncate text-xs min-w-0 flex-1" />

        {/* Expand arrow — right side */}
        {hasContent && (
          <span
            className="shrink-0 text-[11px] text-sumi-faint group-hover:text-sumi-light transition-colors"
          >
            {expanded ? "▴" : "▾"}
          </span>
        )}
      </div>

      {/* Expanded content */}
      {expanded && content && <FormatContent content={content} type={event.type} />}
    </div>
  );
}

/* ── LiveStream container ── */

type SandboxStatus = { status: "running" | "stopped" | "not_running" };

export function LiveStream() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`;
  const { events, connected, clearEvents, seedEvents } = useWebSocket(wsUrl);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Seed with recent events from current session on mount
  useEffect(() => {
    fetchJson<{ events: { type: string; data: unknown; timestamp: string }[] }>("/telemetry/events/recent?limit=200")
      .then((res) => { if (res.events.length > 0) seedEvents(res.events); })
      .catch(() => {});
  }, [seedEvents]);

  const { data: sandbox } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => fetchJson<SandboxStatus>("/sandbox/status"),
    refetchInterval: 5000,
  });
  const agentRunning = sandbox?.status === "running";

  const visibleEvents = events.filter((e) => !HIDDEN_EVENTS.has(e.type));

  // Collect iteration summaries from summary events to attach to end dividers
  const iterationSummaries = new Map<number, string>();
  for (const e of events) {
    if (e.type === "iteration_summary") {
      const d = typeof e.data === "object" ? (e.data as any) : {};
      if (d.iterationId && d.summary) {
        iterationSummaries.set(d.iterationId, d.summary);
      }
    }
  }

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    setIsNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  // Auto-scroll only when near bottom
  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, isNearBottom]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsNearBottom(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="kanji-accent text-base">流</span>
            <h2 className="section-heading">Live Stream</h2>
          </div>
          {visibleEvents.length > 0 && (
            <span className="text-[10px] font-mono text-sumi-faint bg-washi-dark px-2 py-0.5 rounded-full">
              {visibleEvents.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {visibleEvents.length > 0 && (
            <button
              onClick={clearEvents}
              className="text-[10px] font-mono text-sumi-faint hover:text-sumi-light transition-colors tracking-wide uppercase"
            >
              Clear
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {!connected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-shu" />
                <span className="text-xs font-medium text-shu">Disconnected</span>
              </>
            ) : agentRunning ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-matcha animate-pulse" />
                <span className="text-xs font-medium text-matcha">Live</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-sumi-faint" />
                <span className="text-xs font-medium text-sumi-faint">Idle</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Event stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-auto font-mono text-sm space-y-px pr-1"
      >
        {visibleEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <span className="text-3xl font-serif text-sumi-faint/30">流</span>
            <p className="text-sumi-faint text-sm font-sans">Waiting for events...</p>
          </div>
        )}
        {visibleEvents.map((event, i) => {
          const d = typeof event.data === "object" ? (event.data as any) : {};
          const iterId = d?.iterationId ?? d?.iteration_id;
          return (
            <EventRow
              key={i}
              event={event}
              iterationSummary={iterId != null ? iterationSummaries.get(iterId) : undefined}
            />
          );
        })}
        <div ref={bottomRef} className="h-8" />
      </div>

      {/* Scroll-to-bottom button */}
      {!isNearBottom && visibleEvents.length > 0 && (
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-washi-panel to-transparent" />
          <button
            onClick={scrollToBottom}
            className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-washi-dark border border-washi-border text-sumi-faint hover:text-sumi-light hover:border-sumi-faint flex items-center justify-center transition-all text-xs"
            title="Scroll to bottom"
          >
            &#9662;
          </button>
        </div>
      )}
    </div>
  );
}
