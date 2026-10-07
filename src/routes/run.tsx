import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { CrewHelix } from "@/components/crew-helix";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HOT_PATH } from "@/lib/harness/graph";
import { adaptSimEvents, SAMPLE_ISSUE, SIM_DURATION } from "@/lib/harness/simulation";
import type { CrewId } from "@/lib/harness/types";
import { formatTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";
import { cn } from "@/lib/utils";

const TokenChart = lazy(() =>
  import("@/components/token-chart").then((m) => ({ default: m.TokenChart })),
);

export const Route = createFileRoute("/run")({ component: RunPage });

function RunPage() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [mounted, setMounted] = useState(false);
  const config = selectConfig(useHarness());
  const adapted = useMemo(() => adaptSimEvents(config), [config]);
  const events = adapted.events;

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

  const visible = events.filter((e) => e.t <= t);
  const current = visible[visible.length - 1] ?? events[0];
  const last = events[events.length - 1];
  const activeRole = (current.role === "system" ? "conductor" : current.role) as CrewId;
  const chart = useMemo(
    () =>
      events
        .filter((e) => e.t <= t)
        .map((e) => ({
          t: e.t / 1000,
          helix: e.tokens,
          naive: e.naiveTokens,
        })),
    [events, t],
  );

  const hot =
    current.role === "scout" || current.role === "auditor" ? HOT_PATH : ["rl", "bypass", "auth"];

  function step() {
    const next = events.find((e) => e.t > t);
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
          <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-steel">
            <span>Run · {SAMPLE_ISSUE.id}</span>
            <Badge variant="warn">Simulated</Badge>
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
            {SAMPLE_ISSUE.title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{SAMPLE_ISSUE.body}</p>
          {adapted.dropped.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Timeline skips {adapted.dropped.join(", ")} — disabled on the crew rail. Token figures
              rescale with your live config.
            </p>
          )}
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
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Handoffs
            </p>
            <p className="font-mono text-[11px] tabular text-steel">
              {formatTokens(current.tokens)} helix
              <span className="text-muted-foreground">
                {" "}
                · {formatTokens(current.naiveTokens)} naive
              </span>
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
                  {e.tool && (
                    <p className="font-mono text-[10px] text-muted-foreground">{e.tool}</p>
                  )}
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
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Token path
          </p>
          <p className="text-sm text-muted-foreground">
            Finish at {formatTokens(last.tokens)} vs {formatTokens(last.naiveTokens)} —{" "}
            {ratio.toFixed(1)}× less than globbing <span className="font-mono">src/http</span>
          </p>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Illustrative estimate for a fictional repo — event tokens are scripted, not measured. The
          always-on index in the header is computed live from your crew and stack.
        </p>
        <div className="h-44 sm:h-56">
          {mounted ? (
            <Suspense fallback={<div className="shimmer h-full rounded-xl" />}>
              <TokenChart data={chart} />
            </Suspense>
          ) : (
            <div className="h-full rounded-xl bg-secondary" />
          )}
        </div>
      </section>

      <section className="mt-8">
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Active role
        </p>
        <CrewHelix active={activeRole} compact />
      </section>
    </Shell>
  );
}
