import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CrewHelix } from "@/components/crew-helix";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { HOT_PATH } from "@/lib/harness/graph";
import { SAMPLE_ISSUE, SIM_DURATION, SIM_EVENTS } from "@/lib/harness/simulation";
import type { CrewId } from "@/lib/harness/types";
import { formatTokens } from "@/lib/harness/tokens";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/run")({ component: RunPage });

function RunPage() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setT((x) => {
        if (x >= SIM_DURATION) {
          setPlaying(false);
          return SIM_DURATION;
        }
        return x + 120;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [playing]);

  const visible = SIM_EVENTS.filter((e) => e.t <= t);
  const current = visible[visible.length - 1] ?? SIM_EVENTS[0];
  const last = SIM_EVENTS[SIM_EVENTS.length - 1];
  const activeRole = (current.role === "system" ? "conductor" : current.role) as CrewId;
  const chart = useMemo(
    () =>
      SIM_EVENTS.filter((e) => e.t <= t).map((e) => ({
        t: e.t / 1000,
        helix: e.tokens,
        naive: e.naiveTokens,
      })),
    [t],
  );

  const hot =
    current.role === "scout" || current.role === "auditor" ? HOT_PATH : ["rl", "bypass", "auth"];

  function step() {
    const next = SIM_EVENTS.find((e) => e.t > t);
    setPlaying(false);
    setT(next ? next.t : SIM_DURATION);
  }

  function reset() {
    setT(0);
    setPlaying(true);
  }

  const ratio = last.naiveTokens / Math.max(last.tokens, 1);

  return (
    <Shell>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Run · {SAMPLE_ISSUE.id}</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">{SAMPLE_ISSUE.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{SAMPLE_ISSUE.body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="outline" size="sm" onClick={step}>
            <StepForward className="size-3.5" />
            Step
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Replay
          </Button>
        </div>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="rounded-[28px] bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Handoffs</p>
            <p className="font-mono text-[11px] tabular text-steel">
              {formatTokens(current.tokens)} helix
              <span className="text-muted-foreground"> · {formatTokens(current.naiveTokens)} naive</span>
            </p>
          </div>
          <ol className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
            {visible.map((e, i) => (
              <li
                key={`${e.t}-${e.title}`}
                className={cn(
                  "rounded-2xl bg-secondary px-3.5 py-3",
                  i === visible.length - 1 && "bg-background shadow-[var(--shadow-border)]",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-steel">
                    {e.role} · {e.title}
                  </p>
                  {e.tool && <p className="font-mono text-[10px] text-muted-foreground">{e.tool}</p>}
                </div>
                <p className="mt-1 text-sm leading-relaxed">{e.body}</p>
                {e.files && (
                  <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-signal">
                    {e.files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-[28px] bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Cited subgraph
            </p>
            <KnowledgeGraph activeIds={hot} />
          </div>
        </div>
      </div>

      <section className="mt-6 rounded-[28px] bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Token path</p>
          <p className="text-sm text-muted-foreground">
            Finish at {formatTokens(last.tokens)} vs {formatTokens(last.naiveTokens)} — {ratio.toFixed(1)}×
            less than globbing <span className="font-mono">src/http</span>
          </p>
        </div>
        <div className="h-44 sm:h-56">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          ) : (
            <div className="h-full rounded-xl bg-secondary" />
          )}
        </div>
      </section>

      <section className="mt-8">
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Active role</p>
        <CrewHelix active={activeRole} compact />
      </section>
    </Shell>
  );
}
