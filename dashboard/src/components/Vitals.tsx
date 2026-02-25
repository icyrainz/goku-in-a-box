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
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">System Vitals</h2>

      {latest && (
        <div className="flex gap-4 mb-3 text-xs">
          <div>
            <span className="text-gray-500">CPU</span>{" "}
            <span className="text-cyan-400 font-mono">{latest.cpu_pct.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-gray-500">MEM</span>{" "}
            <span className="text-green-400 font-mono">{latest.memory_mb}MB</span>
          </div>
          <div>
            <span className="text-gray-500">DISK</span>{" "}
            <span className="text-yellow-400 font-mono">{latest.disk_mb}MB</span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
            <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" />
            <Tooltip
              contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Line type="monotone" dataKey="cpu_pct" stroke="#06b6d4" strokeWidth={2} dot={false} name="CPU %" />
            <Line type="monotone" dataKey="memory_mb" stroke="#22c55e" strokeWidth={2} dot={false} name="Memory MB" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
