import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type SandboxStatus = { status: "running" | "stopped" | "not_running"; containerId?: string };

export function Header() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => fetchJson<SandboxStatus>("/sandbox/status"),
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: () => postJson("/sandbox/start", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/sandbox/stop", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const isRunning = status?.status === "running";

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-gray-900 text-white border-b border-gray-700">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold tracking-tight">Goku-in-a-Box</h1>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-sm text-gray-300 capitalize">
            {status?.status ?? "loading..."}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => startMutation.mutate()}
          disabled={isRunning || startMutation.isPending}
          className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >
          {startMutation.isPending ? "Starting..." : "Start"}
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={!isRunning || stopMutation.isPending}
          className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >
          {stopMutation.isPending ? "Stopping..." : "Stop"}
        </button>
      </div>
    </header>
  );
}
