import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

type Holding = { name: string; symbol: string; weight: number; marketValue: number };

interface Props { holdings: Holding[] }

const COLORS = ["#2563eb", "#7c3aed", "#16a34a", "#dc2626", "#d97706", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#0d9488"];

export default function HoldingsPie({ holdings }: Props) {
  // 取前 9，剩余合并为"其他"
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const top = sorted.slice(0, 9);
  const rest = sorted.slice(9);
  const data = [...top.map((h) => ({ name: `${h.name} (${h.symbol})`, value: h.marketValue, weight: h.weight }))];
  if (rest.length > 0) {
    data.push({
      name: `其他 (${rest.length})`,
      value: rest.reduce((s, x) => s + x.marketValue, 0),
      weight: rest.reduce((s, x) => s + x.weight, 0),
    });
  }
  return (
    <div className="w-full" style={{ height: 340 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={120} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />)}
          </Pie>
          <Tooltip
            formatter={(v: number, _name, payload: any) => [`¥${v.toLocaleString()} · ${(payload.payload.weight * 100).toFixed(1)}%`, payload.payload.name]}
            contentStyle={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8 }}
          />
          <Legend verticalAlign="bottom" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
