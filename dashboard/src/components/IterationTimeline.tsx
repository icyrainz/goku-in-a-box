import { useState } from "react";
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

export function IterationTimeline() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["iterations"],
    queryFn: () => fetchJson<{ iterations: Iteration[] }>("/telemetry/iterations?limit=50"),
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery({
    queryKey: ["iteration", selectedId],
    queryFn: () => fetchJson<IterationDetail>(`/telemetry/iteration/${selectedId}`),
    enabled: selectedId !== null,
  });

  const iterations = data?.iterations ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="kanji-accent text-base">道</span>
        <h2 className="section-heading">Iterations</h2>
      </div>

      <div className="flex-1 overflow-auto space-y-1">
        {iterations.length === 0 && (
          <p className="text-sumi-faint italic text-sm">No iterations yet</p>
        )}
        {iterations.map((iter) => {
          const selected = iter.id === selectedId;
          return (
            <button
              key={iter.id}
              onClick={() => setSelectedId(selected ? null : iter.id)}
              className={`w-full text-left p-2.5 rounded text-sm transition-all flex items-start gap-2.5 ${
                selected
                  ? "bg-ai-wash border border-ai/20"
                  : "hover:bg-washi-dark border border-transparent"
              }`}
            >
              <span className={`w-2 h-2 rounded-full mt-1 shrink-0 transition-colors ${
                selected ? "bg-ai" : "bg-washi-border"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sumi-light font-medium">#{iter.id}</span>
                  <span className="text-sumi-faint">
                    {iter.action_count} actions
                    {iter.error_count > 0 && (
                      <span className="text-shu ml-1 font-medium">({iter.error_count} err)</span>
                    )}
                  </span>
                </div>
                {iter.summary && (
                  <p className="text-sumi truncate mt-0.5">{iter.summary}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {detail && (
        <div className="mt-3 pt-3 border-t border-washi-border max-h-40 overflow-auto text-sm space-y-1">
          {detail.events.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-sumi-faint shrink-0 font-mono">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-kin shrink-0 font-medium">[{e.type}]</span>
              <span className="text-sumi truncate">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
