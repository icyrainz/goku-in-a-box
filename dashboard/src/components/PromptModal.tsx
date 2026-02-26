import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { fetchJson, putJson } from "../api/client";

type PromptData = { content: string; updated_at: string | null };

export function PromptModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data: prompt } = useQuery({
    queryKey: ["prompt"],
    queryFn: () => fetchJson<PromptData>("/prompt"),
  });

  const saveMutation = useMutation({
    mutationFn: (content: string) => putJson("/prompt", { content }),
    onSuccess: () => {
      setLocalContent(null);
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["prompt"] });
    },
  });

  const currentContent = localContent ?? prompt?.content ?? "";
  const isDirty = localContent !== null && localContent !== (prompt?.content ?? "");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop" onClick={onClose}>
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[700px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">筆</span>
            <h2 className="section-heading">Agent Prompt</h2>
            {prompt?.updated_at && (
              <span className="text-xs text-sumi-faint ml-1">
                Updated {new Date(prompt.updated_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing && isDirty && <span className="text-xs text-kitsune font-medium">Unsaved</span>}
            {editing && (
              <button
                onClick={() => { if (localContent) saveMutation.mutate(localContent); }}
                disabled={!isDirty || saveMutation.isPending}
                className="btn-ink btn-ai text-xs"
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </button>
            )}
            <button
              onClick={() => { setEditing(!editing); setLocalContent(null); }}
              className="btn-ink text-xs"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button onClick={onClose} className="text-sumi-faint hover:text-sumi text-lg leading-none ml-1 transition-colors">
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 min-h-[300px]">
          {editing ? (
            <div className="h-full rounded overflow-hidden border border-washi-border">
              <Editor
                defaultLanguage="markdown"
                theme="vs-dark"
                value={currentContent}
                onChange={(value) => setLocalContent(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "off",
                  wordWrap: "on",
                  padding: { top: 12 },
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
            </div>
          ) : (
            <pre className="text-sm text-sumi whitespace-pre-wrap font-mono leading-relaxed">
              {prompt?.content || <span className="text-sumi-faint italic font-sans">No prompt set</span>}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
