import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type Snapshot = {
  id: number;
  label: string;
  agentType: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<{ snapshots: Snapshot[] }>("/snapshots"),
  });

  const captureMutation = useMutation({
    mutationFn: () => postJson("/snapshots/capture", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => postJson(`/snapshots/${id}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-status"] });
      setRestoringId(null);
      onClose();
    },
    onError: () => setRestoringId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetchJson(`/snapshots/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const snapshots = data?.snapshots ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[600px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">蔵</span>
            <h2 className="section-heading">Snapshots</h2>
            {snapshots.length > 0 && (
              <span className="text-[10px] font-mono text-sumi-faint bg-washi-dark px-2 py-0.5 rounded-full">
                {snapshots.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => captureMutation.mutate()}
              disabled={captureMutation.isPending}
              className="btn-ink btn-ai text-xs"
            >
              {captureMutation.isPending ? "Capturing..." : "Capture Now"}
            </button>
            <button
              onClick={onClose}
              className="text-sumi-faint hover:text-sumi text-lg leading-none ml-1 transition-colors"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-[200px]">
          {isLoading && (
            <p className="p-5 text-sm text-sumi-faint italic">Loading...</p>
          )}
          {!isLoading && snapshots.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-3xl font-serif text-sumi-faint/30">蔵</span>
              <p className="text-sumi-faint text-sm">No snapshots yet</p>
              <p className="text-sumi-faint/60 text-xs">
                Start the sandbox and click Capture Now
              </p>
            </div>
          )}
          <div className="divide-y divide-washi-border/40">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-washi-dark/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-sumi font-medium truncate">
                    {snap.label}
                  </p>
                  <p className="text-[11px] text-sumi-faint font-mono mt-0.5">
                    {snap.agentType} · {formatBytes(snap.sizeBytes)} ·{" "}
                    {new Date(snap.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setRestoringId(snap.id);
                      restoreMutation.mutate(snap.id);
                    }}
                    disabled={restoreMutation.isPending}
                    className="btn-ink btn-matcha text-xs"
                  >
                    {restoreMutation.isPending && restoringId === snap.id
                      ? "Restoring..."
                      : "Restore"}
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(snap.id)}
                    disabled={deleteMutation.isPending || restoreMutation.isPending}
                    className="btn-ink text-xs text-shu hover:border-shu/40"
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {(captureMutation.isError || restoreMutation.isError) && (
          <div className="px-5 py-3 border-t border-washi-border text-xs text-shu">
            {(captureMutation.error as Error)?.message ??
              (restoreMutation.error as Error)?.message}
          </div>
        )}
      </div>
    </div>
  );
}
