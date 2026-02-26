import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchJson } from "../api/client";

type VitalPoint = { timestamp: string; cpu_pct: number; memory_mb: number; disk_mb: number };

type Metric = "cpu" | "memory" | "disk";

const METRIC_CONFIG: Record<Metric, { label: string; kanji: string; dataKey: string; unit: string; color: string; colorFaint: string }> = {
  cpu: { label: "CPU", kanji: "処", dataKey: "cpu_pct", unit: "%", color: "#5A9BD5", colorFaint: "rgba(90, 155, 213, 0.15)" },
  memory: { label: "Memory", kanji: "記", dataKey: "memory_mb", unit: "MB", color: "#7BA85A", colorFaint: "rgba(123, 168, 90, 0.15)" },
  disk: { label: "Disk", kanji: "盤", dataKey: "disk_mb", unit: "MB", color: "#D4915E", colorFaint: "rgba(212, 145, 94, 0.15)" },
};

function formatValue(metric: Metric, value: number): string {
  if (metric === "cpu") return value.toFixed(1);
  return String(Math.round(value));
}

function StatCard({ metric, value, active, onClick }: { metric: Metric; value: number | undefined; active: boolean; onClick: () => void }) {
  const config = METRIC_CONFIG[metric];
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-2 transition-all text-left border ${
        active
          ? "border-washi-border bg-washi-dark/60"
          : "border-transparent hover:bg-washi-dark/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-sumi-faint tracking-wide uppercase">{config.label}</span>
        <span className="font-serif text-xs" style={{ color: config.color, opacity: active ? 1 : 0.4 }}>{config.kanji}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg font-semibold" style={{ color: config.color }}>
          {value !== undefined ? formatValue(metric, value) : "—"}
        </span>
        <span className="text-[10px] text-sumi-faint font-mono">{config.unit}</span>
      </div>
    </button>
  );
}

export function Vitals() {
  const [activeMetrics, setActiveMetrics] = useState<Set<Metric>>(new Set(["cpu", "memory"]));

  const { data } = useQuery({
    queryKey: ["vitals"],
    queryFn: () => fetchJson<{ vitals: VitalPoint[] }>("/telemetry/vitals?limit=60"),
    refetchInterval: 5000,
  });

  const points = [...(data?.vitals ?? [])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((v, i) => ({
      ...v,
      idx: i,
      time: new Date(v.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    }));

  const latest = data?.vitals?.[0];

  // Compute evenly-spaced tick indices (show ~5 labels max)
  const tickCount = Math.min(5, points.length);
  const xTicks = tickCount > 1
    ? Array.from({ length: tickCount }, (_, i) => Math.round((i * (points.length - 1)) / (tickCount - 1)))
    : points.length === 1 ? [0] : [];

  const toggleMetric = (m: Metric) => {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m); // keep at least one active
      } else {
        next.add(m);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-baseline gap-2 mb-2 shrink-0">
        <span className="kanji-accent text-base">気</span>
        <h2 className="section-heading">System Vitals</h2>
      </div>

      {/* Stat cards */}
      <div className="flex gap-1.5 mb-3 shrink-0">
        {(["cpu", "memory", "disk"] as Metric[]).map((m) => (
          <StatCard
            key={m}
            metric={m}
            value={latest ? (m === "cpu" ? latest.cpu_pct : m === "memory" ? latest.memory_mb : latest.disk_mb) : undefined}
            active={activeMetrics.has(m)}
            onClick={() => toggleMetric(m)}
          />
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {points.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <span className="text-3xl font-serif text-sumi-faint/30">気</span>
            <p className="text-sumi-faint text-sm font-sans">No vitals data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                {(["cpu", "memory", "disk"] as Metric[]).map((m) => (
                  <linearGradient key={m} id={`grad-${m}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={METRIC_CONFIG[m].color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={METRIC_CONFIG[m].color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#38342F" vertical={false} />
              <XAxis
                dataKey="idx"
                type="number"
                domain={[0, Math.max(points.length - 1, 1)]}
                ticks={xTicks}
                tickFormatter={(idx: number) => points[idx]?.time ?? ""}
                tick={{ fontSize: 9, fill: "#5C5650", fontFamily: "'JetBrains Mono', monospace" }}
                stroke="#38342F"
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#5C5650", fontFamily: "'JetBrains Mono', monospace" }}
                stroke="#38342F"
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(_label: unknown, payload: readonly { payload?: { time?: string } }[]) => payload[0]?.payload?.time ?? ""}
                contentStyle={{
                  backgroundColor: "#1C1916",
                  border: "1px solid #38342F",
                  borderRadius: "6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "11px",
                  color: "#D8D0C4",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
                  padding: "8px 12px",
                }}
                labelStyle={{ color: "#8A827A", fontWeight: 500, marginBottom: 4, fontSize: "10px" }}
                itemStyle={{ padding: "1px 0" }}
              />
              {(["cpu", "memory", "disk"] as Metric[]).map((m) =>
                activeMetrics.has(m) ? (
                  <Area
                    key={m}
                    type="monotone"
                    dataKey={METRIC_CONFIG[m].dataKey}
                    stroke={METRIC_CONFIG[m].color}
                    strokeWidth={2}
                    fill={`url(#grad-${m})`}
                    dot={false}
                    name={`${METRIC_CONFIG[m].label} (${METRIC_CONFIG[m].unit})`}
                    animationDuration={300}
                  />
                ) : null
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
