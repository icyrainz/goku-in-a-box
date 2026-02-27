import { useState, useEffect } from "react";
import { putJson, postJson } from "../api/client";
import { useQueryClient } from "@tanstack/react-query";

type AgentType = "opencode" | "goose";

const PRESETS = [
  {
    label: "Browser Game",
    kanji: "遊",
    prompt: "Build a fun, playable browser game using HTML, CSS, and JavaScript. Choose a classic game concept (snake, breakout, tetris, etc.) and implement it with smooth controls, scoring, and a polished UI.",
  },
  {
    label: "REST API",
    kanji: "接",
    prompt: "Create a RESTful API service with proper routing, request validation, error handling, and a few sample endpoints. Include a health check route and basic documentation.",
  },
  {
    label: "CLI Tool",
    kanji: "道",
    prompt: "Build a command-line tool that solves a practical problem. Include argument parsing, help text, colored output, and error handling. Make it something genuinely useful.",
  },
  {
    label: "Explore Environment",
    kanji: "探",
    prompt: "Explore and thoroughly document the current environment: installed tools, languages, runtimes, available commands, filesystem layout, and system capabilities. Write a comprehensive environment report.",
  },
];

export function StartModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [agentType, setAgentType] = useState<AgentType>("opencode");
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  const canStart = prompt.trim().length > 0 && !starting;

  const handlePresetClick = (index: number) => {
    setSelectedPreset(index);
    setPrompt(PRESETS[index].prompt);
  };

  const handleStart = async () => {
    if (!canStart) return;
    setStarting(true);
    try {
      await postJson("/sandbox/start", { agentType });
      await putJson("/prompt", { content: prompt.trim() });
      queryClient.invalidateQueries({ queryKey: ["sandbox-status"] });
      onClose();
    } catch {
      setStarting(false);
    }
  };

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
        className="bg-washi-panel border border-washi-border rounded-lg w-[640px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">始</span>
            <h2 className="section-heading">New Session</h2>
          </div>
          <button onClick={onClose} className="text-sumi-faint hover:text-sumi text-lg leading-none transition-colors">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Preset cards */}
          <div>
            <label className="text-xs font-semibold text-sumi-light uppercase tracking-wider mb-2.5 block">
              Quick Start
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {PRESETS.map((preset, i) => (
                <button
                  key={i}
                  onClick={() => handlePresetClick(i)}
                  className={`text-left px-3.5 py-3 rounded border transition-all ${
                    selectedPreset === i
                      ? "border-matcha bg-matcha/10 text-sumi-deep"
                      : "border-washi-border hover:border-sumi-faint text-sumi"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="kanji-accent text-sm">{preset.kanji}</span>
                    <span className="text-sm font-medium">{preset.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom prompt */}
          <div>
            <label className="text-xs font-semibold text-sumi-light uppercase tracking-wider mb-2.5 block">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setSelectedPreset(null);
              }}
              placeholder="Describe what the agent should build or do..."
              rows={5}
              className="w-full bg-washi border border-washi-border rounded px-3.5 py-3 text-sm text-sumi font-mono resize-none focus:outline-none focus:border-sumi-faint placeholder:text-sumi-faint/50"
            />
          </div>

          {/* Agent type */}
          <div>
            <label className="text-xs font-semibold text-sumi-light uppercase tracking-wider mb-2.5 block">
              Agent
            </label>
            <div className="flex gap-2.5">
              {(["opencode", "goose"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAgentType(type)}
                  className={`px-4 py-2 rounded border text-sm font-medium transition-all ${
                    agentType === type
                      ? "border-matcha bg-matcha/10 text-sumi-deep"
                      : "border-washi-border hover:border-sumi-faint text-sumi"
                  }`}
                >
                  {type === "opencode" ? "OpenCode" : "Goose"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-washi-border">
          <button onClick={onClose} className="btn-ink text-sm">
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="btn-ink btn-matcha text-sm"
          >
            {starting ? "Starting..." : "Start Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
