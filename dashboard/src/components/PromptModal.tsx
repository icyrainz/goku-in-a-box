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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[700px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Agent Prompt</h2>
            {prompt?.updated_at && (
              <span className="text-xs text-gray-500">
                Updated {new Date(prompt.updated_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing && isDirty && <span className="text-xs text-amber-400">Unsaved</span>}
            {editing && (
              <button
                onClick={() => { if (localContent) saveMutation.mutate(localContent); }}
                disabled={!isDirty || saveMutation.isPending}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </button>
            )}
            <button
              onClick={() => { setEditing(!editing); setLocalContent(null); }}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition-colors"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 min-h-[300px]">
          {editing ? (
            <div className="h-full rounded overflow-hidden border border-gray-700">
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
                }}
              />
            </div>
          ) : (
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {prompt?.content || <span className="text-gray-600 italic">No prompt set</span>}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
