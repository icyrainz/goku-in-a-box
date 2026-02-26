/**
 * Control plane LLM client.
 * Separate from the sandbox LLM — they can point to different models/endpoints.
 * Uses OpenAI-compatible chat completions API.
 */
export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function createLlm(config: LlmConfig) {
  async function complete(prompt: string, maxTokens = 1024): Promise<string> {
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });
      if (!res.ok) return "";
      const data = (await res.json()) as any;
      const msg = data.choices?.[0]?.message;
      // Some models (Qwen3.5) put output in reasoning_content with empty content
      const content = msg?.content?.trim();
      if (content) return content;
      // Fall back: extract last meaningful line from reasoning_content
      const reasoning = msg?.reasoning_content?.trim();
      if (reasoning) {
        // Look for the final answer in the reasoning chain
        const lines = reasoning.split("\n").map((l: string) => l.trim()).filter(Boolean);
        // Find lines that look like a direct answer (quoted or short, no bullet/numbering)
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          const quoted = line.match(/^[""](.+)[""]$/);
          if (quoted) return quoted[1];
        }
        // Last resort: return last non-empty line
        return lines[lines.length - 1] ?? "";
      }
      return "";
    } catch {
      return "";
    }
  }

  async function summarizeIteration(
    iterationId: number,
    events: { type: string; summary: string }[]
  ): Promise<string> {
    if (events.length === 0) return "No activity";

    const eventLog = events
      .filter((e) => e.type !== "iteration_start" && e.type !== "iteration_end")
      .map((e) => `[${e.type}] ${e.summary?.trim()}`)
      .join("\n");

    const prompt = `An AI agent just completed one work iteration. Based on the events below, write a single short sentence describing the PURPOSE or OUTCOME of what happened — not the individual steps. Focus on what was achieved or what goal was being worked toward, not which tools were called or files were read. Return only the summary sentence, nothing else.

Events:
${eventLog}`;

    return await complete(prompt);
  }

  return { complete, summarizeIteration };
}
