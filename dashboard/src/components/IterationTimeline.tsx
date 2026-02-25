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
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Iterations</h2>
      <div className="flex-1 overflow-auto space-y-1">
        {iterations.length === 0 && (
          <p className="text-gray-600 italic text-xs">No iterations yet</p>
        )}
        {iterations.map((iter) => (
          <button
            key={iter.id}
            onClick={() => setSelectedId(iter.id === selectedId ? null : iter.id)}
            className={`w-full text-left p-2 rounded text-xs transition-colors ${
              iter.id === selectedId ? "bg-gray-700" : "hover:bg-gray-800"
            }`}
          >
            <div className="flex justify-between">
              <span className="font-mono text-gray-400">#{iter.id}</span>
              <span className="text-gray-500">
                {iter.action_count} actions
                {iter.error_count > 0 && (
                  <span className="text-red-400 ml-1">({iter.error_count} errors)</span>
                )}
              </span>
            </div>
            {iter.summary && (
              <p className="text-gray-300 truncate mt-0.5">{iter.summary}</p>
            )}
          </button>
        ))}
      </div>

      {detail && (
        <div className="mt-2 pt-2 border-t border-gray-700 max-h-40 overflow-auto text-xs space-y-1">
          {detail.events.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-gray-600 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="text-yellow-400 shrink-0">[{e.type}]</span>
              <span className="text-gray-300 truncate">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
