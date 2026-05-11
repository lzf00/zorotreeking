import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Props {
  data: { period: string; totalValue: number; netValue: number }[];
}

export default function NetValueChart({ data }: Props) {
  if (data.length === 0) return <div className="text-sm text-[var(--text-tertiary)] py-6 text-center">无历史数据</div>;
  return (
    <div className="w-full" style={{ height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="var(--text-tertiary)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--text-tertiary)" domain={["auto", "auto"]} />
          <Tooltip
            formatter={(v: number, name: string) => [name === "netValue" ? v.toFixed(4) : `¥${v.toLocaleString()}`, name === "netValue" ? "净值" : "市值"]}
            contentStyle={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8 }}
          />
          <ReferenceLine y={1} stroke="var(--text-tertiary)" strokeDasharray="2 4" />
          <Line type="monotone" dataKey="netValue" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
