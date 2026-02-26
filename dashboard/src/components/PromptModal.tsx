import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { fetchJson, putJson } from "../api/client";

type PromptData = { content: string; updated_at: string | null };

export function PromptModal({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState<PromptData | null>(null);
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchJson<PromptData>("/prompt").then(setPrompt);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!localContent) return;
    setSaving(true);
    await putJson("/prompt", { content: localContent });
    setSaving(false);
    setLocalContent(null);
    setEditing(false);
    load();
  };

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
                onClick={save}
                disabled={!isDirty || saving}
                className="btn-ink btn-ai text-xs"
              >
                {saving ? "Saving..." : "Save"}
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
            <div className="rounded overflow-hidden border border-washi-border" style={{ height: "min(60vh, 500px)" }}>
              <Editor
                height="100%"
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
