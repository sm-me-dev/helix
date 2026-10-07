import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatTokens } from "@/lib/harness/tokens";

export type TokenPoint = { t: number; helix: number; naive: number };

export function TokenChart({ data }: { data: TokenPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="t" hide />
        <YAxis hide />
        <Tooltip
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--color-foreground)",
          }}
          formatter={(value, name) => [
            formatTokens(Number(value ?? 0)),
            name === "helix" ? "Helix" : "Naive",
          ]}
          labelFormatter={(label) => `${label}s`}
        />
        <Area
          type="monotone"
          dataKey="naive"
          stroke="var(--color-steel)"
          fill="var(--color-steel)"
          fillOpacity={0.12}
          strokeWidth={1.4}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="helix"
          stroke="var(--color-paper)"
          fill="var(--color-paper)"
          fillOpacity={0.22}
          strokeWidth={1.8}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
