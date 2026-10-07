import { useMemo, useState } from "react";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  HOT_PATH,
  NODE_EXPLAIN,
  SAMPLE_GRAPH,
} from "@/lib/harness/graph";
import { cn } from "@/lib/utils";

const KIND_FILL: Record<string, string> = {
  fn: "var(--color-paper)",
  mod: "var(--color-steel)",
  test: "var(--color-signal)",
  type: "color-mix(in oklab, var(--color-paper) 55%, var(--color-steel))",
  cfg: "var(--color-warn)",
};

export function KnowledgeGraph({
  activeIds = HOT_PATH,
  className,
  onSelect,
}: {
  activeIds?: string[];
  className?: string;
  onSelect?: (id: string) => void;
}) {
  const [picked, setPicked] = useState<string>("rl");
  const active = useMemo(() => new Set(activeIds), [activeIds]);
  const node = GRAPH_NODES.find((n) => n.id === picked) ?? GRAPH_NODES[0];

  function choose(id: string) {
    setPicked(id);
    onSelect?.(id);
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <svg
        viewBox="0 0 100 96"
        className="h-auto w-full"
        role="img"
        aria-label="ledger-api knowledge graph"
      >
        {GRAPH_EDGES.map((e) => {
          const a = GRAPH_NODES.find((n) => n.id === e.from);
          const b = GRAPH_NODES.find((n) => n.id === e.to);
          if (!a || !b) return null;
          const hot = active.has(e.from) && active.has(e.to);
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={hot ? "var(--color-paper)" : "var(--color-border)"}
              strokeWidth={hot ? 0.45 : 0.28}
              strokeOpacity={hot ? 0.7 : 0.55}
              strokeDasharray={e.kind === "tests" ? "1.2 0.8" : e.kind === "imports" ? "0.6 0.6" : undefined}
            />
          );
        })}
        {GRAPH_NODES.map((n) => {
          const hot = active.has(n.id);
          const selected = n.id === picked;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              className="cursor-pointer"
              onClick={() => choose(n.id)}
            >
              {selected && (
                <circle r="4.4" fill="none" stroke="var(--color-paper)" strokeOpacity="0.45" strokeWidth="0.3" />
              )}
              <circle
                r={hot ? 1.7 : 1.35}
                fill={KIND_FILL[n.kind]}
                opacity={hot ? 1 : 0.45}
              />
              <text
                x="2.4"
                y="0.9"
                fill="var(--color-foreground)"
                fontSize="3.1"
                opacity={hot ? 0.92 : 0.45}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 rounded-xl bg-secondary px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-steel">
            {SAMPLE_GRAPH.title}
            <span className="text-muted-foreground"> · {SAMPLE_GRAPH.nodes.toLocaleString()} nodes</span>
          </p>
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{node.kind}</p>
        </div>
        <p className="mt-1.5 font-mono text-sm text-paper">{node.label}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{NODE_EXPLAIN[node.id]}</p>
      </div>
    </div>
  );
}
