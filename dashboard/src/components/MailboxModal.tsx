import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, putJson } from "../api/client";

type MailboxState = {
  agent_msg: string | null;
  human_msg: string | null;
  agent_updated_at: string | null;
  human_updated_at: string | null;
};

function timeAgo(ts: string): string {
  const normalized = ts.includes("T") ? ts : ts.replace(" ", "T");
  const diff = Math.floor((Date.now() - new Date(normalized + "Z").getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function MailboxModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");

  const { data: mailbox, isLoading } = useQuery({
    queryKey: ["mailbox"],
    queryFn: () => fetchJson<MailboxState>("/mailbox"),
    refetchInterval: 3000,
  });

  const replyMutation = useMutation({
    mutationFn: (message: string) => putJson("/mailbox/human", { message }),
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasAgent = !!mailbox?.agent_msg;
  const hasHuman = !!mailbox?.human_msg;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[600px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">郵</span>
            <h2 className="section-heading">Mailbox</h2>
            {hasAgent && !hasHuman && (
              <span className="text-[9px] font-mono text-shu bg-shu/10 border border-shu/20 px-1.5 py-px rounded tracking-wide">
                NEEDS REPLY
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
        <div className="flex-1 overflow-auto p-5 space-y-4 min-h-[200px]">
          {isLoading && (
            <p className="text-sm text-sumi-faint italic">Loading...</p>
          )}

          {!isLoading && (
            <>
              {/* Agent message */}
              {hasAgent && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono text-ai uppercase tracking-wider">
                      Agent
                    </span>
                    {mailbox?.agent_updated_at && (
                      <span className="text-[10px] text-sumi-faint font-mono">
                        {timeAgo(mailbox.agent_updated_at)}
                      </span>
                    )}
                  </div>
                  <div className="bg-washi border border-ai/15 rounded-lg px-4 py-3">
                    <p className="text-sm text-sumi whitespace-pre-wrap leading-relaxed">
                      {mailbox!.agent_msg}
                    </p>
                  </div>
                </div>
              )}

              {/* Human message (existing) */}
              {hasHuman && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono text-matcha uppercase tracking-wider">
                      You
                    </span>
                    {mailbox?.human_updated_at && (
                      <span className="text-[10px] text-sumi-faint font-mono">
                        {timeAgo(mailbox.human_updated_at)}
                      </span>
                    )}
                  </div>
                  <div className="bg-washi border border-matcha/15 rounded-lg px-4 py-3">
                    <p className="text-sm text-sumi whitespace-pre-wrap leading-relaxed">
                      {mailbox!.human_msg}
                    </p>
                  </div>
                </div>
              )}

              {/* Empty state hint (only when nothing on either side) */}
              {!hasAgent && !hasHuman && (
                <div className="flex flex-col items-center py-8 gap-2">
                  <span className="text-3xl font-serif text-sumi-faint/30">郵</span>
                  <p className="text-sumi-faint/60 text-xs">
                    Send a message or wait for the agent to post here
                  </p>
                </div>
              )}

              {/* Reply textarea — always available */}
              <div>
                <label className="text-[10px] font-mono text-sumi-light uppercase tracking-wider mb-2 block">
                  {hasHuman ? "Update your message" : "Your message"}
                </label>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your message..."
                  rows={3}
                  className="w-full bg-washi border border-washi-border rounded px-3.5 py-3 text-sm text-sumi font-mono resize-none focus:outline-none focus:border-sumi-faint placeholder:text-sumi-faint/50"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => {
                      if (replyText.trim()) replyMutation.mutate(replyText.trim());
                    }}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="btn-ink btn-matcha text-sm"
                  >
                    {replyMutation.isPending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>

              {replyMutation.isError && (
                <p className="text-xs text-shu mt-2">
                  Failed to send:{" "}
                  {replyMutation.error instanceof Error
                    ? replyMutation.error.message
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
