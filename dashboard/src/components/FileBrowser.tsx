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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[900px] h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Files</h2>
            <span className="text-xs text-gray-500 font-mono">{currentPath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadDir(currentPath)} className="text-xs text-gray-400 hover:text-gray-200">
              Refresh
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-[400px]">
          <div className="w-[300px] border-r border-gray-700 overflow-auto">
            {error && <p className="p-3 text-xs text-red-400">{error}</p>}
            {parentPath && (
              <button
                onClick={() => loadDir(parentPath)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 text-gray-400 font-mono"
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
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 flex items-center gap-2 ${
                  selectedFile?.path === `${currentPath}/${entry.name}` ? "bg-gray-800" : ""
                }`}
              >
                <span className={entry.type === "directory" ? "text-blue-400" : "text-gray-400"}>
                  {entry.type === "directory" ? "+" : " "}
                </span>
                <span className="text-gray-200 font-mono truncate flex-1">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="text-gray-600 shrink-0">{formatSize(entry.size)}</span>
                )}
              </button>
            ))}
            {entries.length === 0 && !loading && (
              <p className="p-3 text-xs text-gray-600 italic">Empty directory</p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {selectedFile ? (
              <div>
                <div className="text-xs text-gray-500 font-mono mb-2">{selectedFile.path}</div>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">
                  {selectedFile.content}
                </pre>
              </div>
            ) : (
              <p className="text-gray-600 italic text-xs">Select a file to view its contents</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
