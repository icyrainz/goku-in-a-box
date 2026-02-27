import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type AgentType = "opencode" | "goose";
type SandboxStatus = { status: "running" | "stopped" | "not_running"; containerId?: string; agentType?: AgentType; sessionId?: string | null };

export function Header({ onPromptClick, onFilesClick, onSnapshotClick, onStartClick, onMailboxClick }: { onPromptClick?: () => void; onFilesClick?: () => void; onSnapshotClick?: () => void; onStartClick?: () => void; onMailboxClick?: () => void }) {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => fetchJson<SandboxStatus>("/sandbox/status"),
    refetchInterval: 5000,
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/sandbox/stop", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const { data: mailbox } = useQuery({
    queryKey: ["mailbox"],
    queryFn: () => fetchJson<{ agent_msg: string | null; human_msg: string | null }>("/mailbox"),
    refetchInterval: 5000,
  });
  const hasMailboxPending = !!mailbox?.agent_msg && !mailbox?.human_msg;

  const isRunning = status?.status === "running";

  return (
    <header className="flex items-center justify-between px-6 py-3.5 bg-washi-panel brush-border-bottom">
      <div className="flex items-center gap-5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-2xl font-extrabold text-sumi-deep tracking-tight leading-none">
            悟空
          </span>
          <span className="font-serif text-base font-semibold text-sumi-light tracking-wide">
            Goku-in-a-Box
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className={`hanko ${isRunning ? "active shu-pulse" : ""}`}>
            {isRunning ? "活" : "止"}
          </div>
          <span className="text-sm text-sumi-light font-medium">
            {isRunning
              ? `稼働中 · ${status?.agentType ?? "opencode"}`
              : status?.status === "stopped" || status?.status === "not_running"
                ? "停止"
                : "..."}
          </span>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        {onPromptClick && (
          <button onClick={onPromptClick} className="btn-ink">
            <span className="kanji-accent text-xs mr-1.5">筆</span>
            Prompt
          </button>
        )}
        {onFilesClick && (
          <button onClick={onFilesClick} className="btn-ink">
            <span className="kanji-accent text-xs mr-1.5">巻</span>
            Files
          </button>
        )}
        {onSnapshotClick && (
          <button onClick={onSnapshotClick} className="btn-ink">
            <span className="kanji-accent text-xs mr-1.5">蔵</span>
            Snapshots
          </button>
        )}
        {onMailboxClick && (
          <button onClick={onMailboxClick} className="btn-ink relative">
            <span className="kanji-accent text-xs mr-1.5">郵</span>
            Mailbox
            {hasMailboxPending && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-shu border border-washi-panel" />
            )}
          </button>
        )}
        <button
          onClick={onStartClick}
          disabled={isRunning}
          className="btn-ink btn-matcha"
        >
          Start
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={!isRunning || stopMutation.isPending}
          className="btn-ink btn-shu"
        >
          {stopMutation.isPending ? "Stopping..." : "Stop"}
        </button>
      </div>
    </header>
  );
}
