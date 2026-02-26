import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../api/client";

type Iteration = {
  id: number;
  start_time: string;
  end_time: string | null;
  summary: string | null;
  action_count: number;
  error_count: number;
};

type IterationDetail = {
  iteration: Iteration;
  events: { id: number; type: string; summary: string; timestamp: string }[];
};

/* ── Badge colors matching LiveStream ── */

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
};

function formatDuration(start: string, end: string | null): string {
  if (!end) return "running";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function IterationTimeline() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const { data } = useQuery({
    queryKey: ["iterations"],
    queryFn: () => fetchJson<{ iterations: Iteration[] }>("/telemetry/iterations?limit=50"),
    refetchInterval: 2000,
  });

  const { data: detail } = useQuery({
    queryKey: ["iteration", selectedId],
    queryFn: () => fetchJson<IterationDetail>(`/telemetry/iteration/${selectedId}`),
    enabled: selectedId !== null,
  });

  const iterations = data?.iterations ?? [];

  // Scroll selected item into view when detail panel appears
  useEffect(() => {
    if (selectedId !== null && selectedRef.current) {
      // Small delay to let the detail panel render and the list resize
      const timer = setTimeout(() => {
        selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [selectedId, detail]);

  const close = useCallback(() => setSelectedId(null), []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="kanji-accent text-base">道</span>
            <h2 className="section-heading">Iterations</h2>
          </div>
          {iterations.length > 0 && (
            <span className="text-[10px] font-mono text-sumi-faint bg-washi-dark px-2 py-0.5 rounded-full">
              {iterations.length}
            </span>
          )}
        </div>
      </div>

      {/* Timeline list */}
      <div className="flex-1 overflow-auto min-h-0">
        {iterations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <span className="text-3xl font-serif text-sumi-faint/30">道</span>
            <p className="text-sumi-faint text-sm font-sans">No iterations yet</p>
          </div>
        )}

        <div className="space-y-0.5">
          {iterations.map((iter) => {
            const selected = iter.id === selectedId;
            const isRunning = !iter.end_time;
            const hasErrors = iter.error_count > 0;

            return (
              <button
                key={iter.id}
                ref={selected ? selectedRef : undefined}
                onClick={() => setSelectedId(selected ? null : iter.id)}
                className={`w-full text-left py-2 px-2 rounded-md transition-all flex items-start gap-3 group ${
                  selected
                    ? "bg-ai-wash/60 border border-ai/15"
                    : isRunning
                      ? "bg-matcha-wash border border-matcha/15"
                      : "hover:bg-washi-dark/50 border border-transparent"
                }`}
              >
                {/* Timeline dot */}
                <div className="shrink-0 mt-1">
                  <span
                    className={`block w-[15px] h-[15px] rounded-full border-2 transition-colors ${
                      isRunning
                        ? "bg-matcha/20 border-matcha matcha-pulse"
                        : hasErrors
                          ? "bg-shu/20 border-shu/60"
                          : selected
                            ? "bg-ai/20 border-ai"
                            : "bg-washi-dark border-washi-border group-hover:border-sumi-faint"
                    }`}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-semibold ${selected ? "text-ai-light" : "text-sumi-light"}`}>
                        #{iter.id}
                      </span>
                      {isRunning && (
                        <span className="text-[9px] font-mono text-matcha bg-matcha/10 border border-matcha/20 px-1.5 py-px rounded tracking-wide">
                          LIVE
                        </span>
                      )}
                      {hasErrors && !isRunning && (
                        <span className="text-[9px] font-mono text-shu bg-shu/10 border border-shu/20 px-1.5 py-px rounded tracking-wide">
                          {iter.error_count} ERR
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-sumi-faint shrink-0">
                      <span className="whitespace-nowrap">{formatTime(iter.start_time)}</span>
                      <span className="text-sumi-faint/50">·</span>
                      <span className={`w-[48px] text-right ${isRunning ? "text-matcha" : ""}`}>{formatDuration(iter.start_time, iter.end_time)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    {iter.summary ? (
                      <p className={`text-xs truncate ${selected ? "text-sumi" : "text-sumi-faint"}`}>
                        {iter.summary}
                      </p>
                    ) : (
                      <span className="text-xs text-sumi-faint/50 italic">
                        {isRunning ? "In progress..." : "No summary"}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-sumi-faint shrink-0 ml-2">
                      {iter.action_count} act
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {detail && (
        <div className="shrink-0 mt-2 pt-2 border-t border-washi-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-sumi-faint tracking-widest uppercase">
              Iteration #{detail.iteration.id} Events
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-sumi-faint">
                {detail.events.length}
              </span>
              <button
                onClick={close}
                className="text-sumi-faint hover:text-sumi hover:bg-washi-dark transition-colors text-sm leading-none p-1.5 -m-1.5 rounded"
                title="Close"
              >
                &times;
              </button>
            </div>
          </div>
          <div className="max-h-36 overflow-auto space-y-px">
            {detail.events.map((e) => {
              const badge = BADGE_STYLE[e.type] ?? "text-sumi-light bg-sumi-light/10 border-sumi-light/15";
              return (
                <div key={e.id} className="flex items-start gap-2 py-[3px] text-xs">
                  <span className="text-sumi-faint shrink-0 font-mono text-[11px] w-[72px]">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`shrink-0 text-[9px] font-semibold tracking-wide px-1.5 py-px rounded border leading-tight ${badge}`}>
                    {e.type}
                  </span>
                  <span className="text-sumi truncate min-w-0">{e.summary}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
