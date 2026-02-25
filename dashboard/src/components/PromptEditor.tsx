import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { fetchJson, putJson } from "../api/client";

type PromptData = { content: string; updated_at: string | null };

export function PromptEditor() {
  const queryClient = useQueryClient();
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data: prompt } = useQuery({
    queryKey: ["prompt"],
    queryFn: () => fetchJson<PromptData>("/prompt"),
  });

  const saveMutation = useMutation({
    mutationFn: (content: string) => putJson("/prompt", { content }),
    onSuccess: () => {
      setLocalContent(null);
      queryClient.invalidateQueries({ queryKey: ["prompt"] });
    },
  });

  const currentContent = localContent ?? prompt?.content ?? "";
  const isDirty = localContent !== null && localContent !== (prompt?.content ?? "");

  const handleSave = useCallback(() => {
    if (localContent) saveMutation.mutate(localContent);
  }, [localContent, saveMutation]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Prompt</h2>
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
          <button
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <div className="flex-1 rounded overflow-hidden border border-gray-700">
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
    </div>
  );
}
