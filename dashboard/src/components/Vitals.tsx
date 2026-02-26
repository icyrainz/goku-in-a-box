import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchJson } from "../api/client";

type VitalPoint = { timestamp: string; cpu_pct: number; memory_mb: number; disk_mb: number };

export function Vitals() {
  const { data } = useQuery({
    queryKey: ["vitals"],
    queryFn: () => fetchJson<{ vitals: VitalPoint[] }>("/telemetry/vitals?limit=60"),
    refetchInterval: 10000,
  });

  const points = (data?.vitals ?? []).reverse().map((v) => ({
    ...v,
    time: new Date(v.timestamp).toLocaleTimeString(),
  }));

  const latest = data?.vitals?.[0];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="kanji-accent text-base">気</span>
          <h2 className="section-heading">System Vitals</h2>
        </div>
        {latest && (
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-sumi-faint">CPU </span>
              <span className="text-ai font-mono font-medium">{latest.cpu_pct.toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-sumi-faint">MEM </span>
              <span className="text-matcha font-mono font-medium">{latest.memory_mb}MB</span>
            </div>
            <div>
              <span className="text-sumi-faint">DSK </span>
              <span className="text-kitsune font-mono font-medium">{latest.disk_mb}MB</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#38342F" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#5C5650" }} stroke="#38342F" />
            <YAxis tick={{ fontSize: 10, fill: "#5C5650" }} stroke="#38342F" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1C1916",
                border: "1px solid #38342F",
                borderRadius: "6px",
                fontFamily: "'Source Sans 3', sans-serif",
                fontSize: "12px",
                color: "#D8D0C4",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
              }}
              labelStyle={{ color: "#8A827A", fontWeight: 500 }}
            />
            <Line type="monotone" dataKey="cpu_pct" stroke="#5A9BD5" strokeWidth={2} dot={false} name="CPU %" />
            <Line type="monotone" dataKey="memory_mb" stroke="#7BA85A" strokeWidth={2} dot={false} name="Memory MB" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
