import { breakdown, formatTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";
import { Term } from "@/components/term";
import { cn } from "@/lib/utils";

export function TokenMeter({ compact = false }: { compact?: boolean }) {
  const alwaysOn = useHarness((s) => breakdown(selectConfig(s)).alwaysOn);
  const naiveAlwaysOn = useHarness((s) => breakdown(selectConfig(s)).naiveAlwaysOn);
  const pct = Math.min(100, (alwaysOn / naiveAlwaysOn) * 100);

  return (
    <div className={cn("flex items-center gap-3", compact ? "min-w-0" : "min-w-[220px]")}>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <Term definition="Tokens loaded on every turn, before the task is known. Lower is cheaper.">
                Always-on
              </Term>
            </span>
            <span className="font-mono text-[11px] tabular text-steel">
              {formatTokens(alwaysOn)}
              <span className="text-muted-foreground"> / {formatTokens(naiveAlwaysOn)} naive</span>
            </span>
          </div>
        )}
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-paper transition-[width] duration-300 ease-[var(--ease-smooth-out)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {compact && (
        <span className="shrink-0 font-mono text-[11px] tabular text-steel">
          {formatTokens(alwaysOn)}
        </span>
      )}
    </div>
  );
}

export function LeanBadge() {
  const b = useHarness((s) => breakdown(selectConfig(s)));
  const passed = b.checks.filter((c) => c.pass).length;
  return (
    <div
      className="flex items-baseline gap-1.5"
      title={b.checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.label}`).join("\n")}
    >
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Lean</span>
      <span className="font-mono text-sm tabular text-paper">{b.leanScore}</span>
      <span className="font-mono text-[11px] tabular text-muted-foreground">
        {passed}/{b.checks.length}
      </span>
    </div>
  );
}
