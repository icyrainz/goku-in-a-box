import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type ShowcaseManifest = {
  type: "web" | "document" | "cli" | "media";
  label?: string;
  command?: string;
  port?: number;
  path?: string;
};

type ShowcaseStatus = {
  running: boolean;
  type: string | null;
  port: number | null;
  label: string | null;
};

type LaunchResult = {
  launched: boolean;
  type: string;
  output?: string;
  proxyUrl?: string;
  path?: string;
  port?: number;
};

export function ShowcaseModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);

  const { data: showcaseData, isLoading } = useQuery({
    queryKey: ["showcase"],
    queryFn: () => fetchJson<{ manifest: ShowcaseManifest | null }>("/showcase"),
    refetchInterval: 5000,
  });

  const { data: statusData } = useQuery({
    queryKey: ["showcase-status"],
    queryFn: () => fetchJson<ShowcaseStatus>("/showcase/status"),
    refetchInterval: 3000,
  });

  const manifest = showcaseData?.manifest ?? null;
  const isRunning = statusData?.running ?? false;

  const launchMutation = useMutation({
    mutationFn: () => postJson<LaunchResult>("/showcase/launch", {}),
    onSuccess: async (result) => {
      setLaunchResult(result);
      queryClient.invalidateQueries({ queryKey: ["showcase-status"] });

      // For document type, fetch the file content
      if (result.type === "document" && result.path) {
        try {
          const data = await fetchJson<{ content: string }>(
            `/sandbox/files/read?path=${encodeURIComponent(result.path)}`
          );
          setDocContent(data.content);
        } catch {
          setDocContent("[Failed to load document content]");
        }
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/showcase/stop", {}),
    onSuccess: () => {
      setLaunchResult(null);
      setDocContent(null);
      queryClient.invalidateQueries({ queryKey: ["showcase-status"] });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasLaunched = !!launchResult?.launched;

  function renderPreview() {
    if (!launchResult) return null;

    switch (launchResult.type) {
      case "web":
        return (
          <iframe
            src="/api/showcase/proxy/"
            className="w-full flex-1 border border-washi-border rounded bg-white"
            title={manifest?.label ?? "Showcase preview"}
          />
        );

      case "cli":
        return (
          <pre className="flex-1 overflow-auto bg-sumi-deep text-matcha/90 font-mono text-xs p-4 rounded border border-washi-border whitespace-pre-wrap">
            {launchResult.output ?? "[No output]"}
          </pre>
        );

      case "document":
        return (
          <pre className="flex-1 overflow-auto bg-washi font-mono text-sm text-sumi p-4 rounded border border-washi-border whitespace-pre-wrap">
            {docContent ?? "Loading..."}
          </pre>
        );

      case "media":
        return (
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            <img
              src={`/api/showcase/file?path=${encodeURIComponent(launchResult.path ?? "")}`}
              alt={manifest?.label ?? "Showcase media"}
              className="max-w-full max-h-full object-contain rounded border border-washi-border"
            />
          </div>
        );

      default:
        return (
          <p className="text-sm text-sumi-faint italic p-4">
            Unknown showcase type: {launchResult.type}
          </p>
        );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[900px] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">展</span>
            <h2 className="section-heading">Showcase</h2>
            {manifest && (
              <span className="text-[10px] font-mono text-matcha bg-matcha/10 border border-matcha/20 px-1.5 py-px rounded tracking-wide uppercase">
                {manifest.type}
              </span>
            )}
            {isRunning && (
              <span className="text-[9px] font-mono text-ai bg-ai/10 border border-ai/20 px-1.5 py-px rounded tracking-wide">
                RUNNING
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-sumi-faint hover:text-sumi text-lg leading-none transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4 min-h-[300px]">
          {isLoading && (
            <p className="text-sm text-sumi-faint italic">Loading...</p>
          )}

          {!isLoading && !manifest && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-3xl font-serif text-sumi-faint/30">展</span>
              <p className="text-sumi-faint text-sm">No showcase manifest found</p>
              <p className="text-sumi-faint/60 text-xs">
                The agent has not created a .showcase.json yet
              </p>
            </div>
          )}

          {!isLoading && manifest && (
            <>
              {/* Manifest details */}
              {!hasLaunched && (
                <div className="bg-washi border border-washi-border rounded-lg px-4 py-3 space-y-1.5">
                  {manifest.label && (
                    <p className="text-sm text-sumi font-medium">{manifest.label}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-sumi-faint">
                    <span>type: {manifest.type}</span>
                    {manifest.command && <span>command: {manifest.command}</span>}
                    {manifest.port && <span>port: {manifest.port}</span>}
                    {manifest.path && <span>path: {manifest.path}</span>}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                {!hasLaunched && (
                  <button
                    onClick={() => launchMutation.mutate()}
                    disabled={launchMutation.isPending}
                    className="btn-ink btn-matcha text-sm"
                  >
                    {launchMutation.isPending ? "Launching..." : "Launch"}
                  </button>
                )}
                {(hasLaunched && manifest.type === "web") && (
                  <button
                    onClick={() => stopMutation.mutate()}
                    disabled={stopMutation.isPending}
                    className="btn-ink btn-shu text-sm"
                  >
                    {stopMutation.isPending ? "Stopping..." : "Stop"}
                  </button>
                )}
              </div>

              {/* Preview content */}
              {hasLaunched && renderPreview()}

              {/* Error display */}
              {launchMutation.isError && (
                <p className="text-xs text-shu">
                  Launch failed:{" "}
                  {launchMutation.error instanceof Error
                    ? launchMutation.error.message
                    : "Unknown error"}
                </p>
              )}
              {stopMutation.isError && (
                <p className="text-xs text-shu">
                  Stop failed:{" "}
                  {stopMutation.error instanceof Error
                    ? stopMutation.error.message
                    : "Unknown error"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
