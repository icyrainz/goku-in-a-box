import { useState, useEffect } from "react";
import { fetchJson } from "../api/client";

type FileEntry = { name: string; type: "file" | "directory"; size: number; modified: string };
type FileList = { path: string; entries: FileEntry[] };
type FileContent = { path: string; content: string };

export function FileBrowser({ onClose }: { onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState("/workspace");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<FileList>(`/sandbox/files?path=${encodeURIComponent(path)}`);
      setEntries(data.entries);
      setCurrentPath(path);
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFile = async (path: string) => {
    setLoading(true);
    try {
      const data = await fetchJson<FileContent>(`/sandbox/files/read?path=${encodeURIComponent(path)}`);
      setSelectedFile(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDir("/workspace"); }, []);

  useEffect(() => {
    const interval = setInterval(() => { if (!selectedFile) loadDir(currentPath); }, 10000);
    return () => clearInterval(interval);
  }, [currentPath, selectedFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const parentPath = currentPath !== "/workspace"
    ? currentPath.split("/").slice(0, -1).join("/") || "/workspace"
    : null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop" onClick={onClose}>
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[900px] h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">巻</span>
            <h2 className="section-heading">Files</h2>
            <span className="text-xs text-sumi-faint font-mono ml-1">{currentPath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadDir(currentPath)} className="btn-ink text-xs">
              Refresh
            </button>
            <button onClick={onClose} className="text-sumi-faint hover:text-sumi text-lg leading-none ml-1 transition-colors">
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-[400px]">
          {/* Directory tree */}
          <div className="w-[300px] border-r border-washi-border overflow-auto bg-washi">
            {error && <p className="p-3 text-xs text-shu font-medium">{error}</p>}
            {parentPath && (
              <button
                onClick={() => loadDir(parentPath)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-washi-dark text-sumi-faint font-mono border-b border-washi-border/40 transition-colors"
              >
                ..
              </button>
            )}
            {entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => {
                  const fullPath = `${currentPath}/${entry.name}`;
                  entry.type === "directory" ? loadDir(fullPath) : loadFile(fullPath);
                }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-washi-dark flex items-center gap-2.5 border-b border-washi-border/20 transition-colors ${
                  selectedFile?.path === `${currentPath}/${entry.name}` ? "bg-ai-wash" : ""
                }`}
              >
                <span className={`text-sm ${entry.type === "directory" ? "text-ai font-medium" : "text-sumi-faint"}`}>
                  {entry.type === "directory" ? "+" : "\u00B7"}
                </span>
                <span className="text-sumi font-mono truncate flex-1">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="text-sumi-faint shrink-0 text-[11px]">{formatSize(entry.size)}</span>
                )}
              </button>
            ))}
            {entries.length === 0 && !loading && (
              <p className="p-4 text-sm text-sumi-faint italic">Empty directory</p>
            )}
          </div>

          {/* File preview */}
          <div className="flex-1 overflow-auto p-5 bg-washi-panel">
            {selectedFile ? (
              <div>
                <div className="text-xs text-sumi-faint font-mono mb-3 pb-2 border-b border-washi-border/50">
                  {selectedFile.path}
                </div>
                <pre className="text-sm text-sumi font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {selectedFile.content}
                </pre>
              </div>
            ) : (
              <p className="text-sumi-faint italic text-sm">Select a file to view its contents</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
