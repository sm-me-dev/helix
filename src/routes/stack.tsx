import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Term } from "@/components/term";
import { Switch } from "@/components/ui/switch";
import { MCPS, mcpSchemaTokens } from "@/lib/harness/mcps";
import { SKILLS } from "@/lib/harness/skills";
import { breakdown, formatTokens, skillTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stack")({ component: StackPage });

const TABS = ["Skills", "MCP"] as const;

function StackPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("MCP");
  const store = useHarness();
  const b = breakdown(selectConfig(store));
  const mcpWarn = store.mcps.length > 5;

  return (
    <Shell>
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Stack</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
            Tools are a performance setting.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Vercel stripped 80% of an agent’s tools and watched success go 80% → 100% with 37% fewer
            tokens. Helix defaults to Graphify, Context7, and Playwright. Everything else is opt-in.
          </p>
        </div>
        <p className="font-mono text-sm tabular text-steel">
          schemas {formatTokens(b.mcpSchemas)}{" "}
          <span className="text-muted-foreground">
            <Term definition="Tokens loaded on every turn, before the task is known. Lower is cheaper.">
              always-on
            </Term>{" "}
            {formatTokens(b.alwaysOn)}
          </span>
        </p>
      </header>

      {mcpWarn && (
        <p className="mt-6 rounded-2xl bg-warn/10 px-4 py-3 text-sm text-warn">
          More than five MCPs. Schema tokens sit in every turn — disable anything this repo will not
          call.
        </p>
      )}

      <div className="mt-8 flex gap-1 rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg px-3 py-2.5 text-sm transition-[background-color,color] duration-150 ease-out",
              tab === t
                ? "bg-card text-foreground shadow-[var(--shadow-border)]"
                : "text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Skills" && (
        <ul className="mt-6 grid gap-3">
          {SKILLS.map((s) => {
            const on = store.skills.includes(s.id);
            return (
              <li
                key={s.id}
                className="rounded-2xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm text-paper">{s.name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {s.description}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-steel">
                      {skillTokens(s.id).index} index · {skillTokens(s.id).body} body on demand ·{" "}
                      {s.loadsWhen}
                    </p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={() => store.toggleSkill(s.id)}
                    aria-label={s.name}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "MCP" && (
        <ul className="mt-6 grid gap-3 lg:grid-cols-2">
          {MCPS.map((m) => {
            const on = store.mcps.includes(m.id);
            return (
              <li
                key={m.id}
                className="rounded-2xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="font-medium">{m.name}</h2>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {m.maintainer}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{m.job}</p>
                    <p className="mt-2 font-mono text-[11px] text-steel">
                      {m.tools.join(" · ")} · {formatTokens(mcpSchemaTokens(m.id).tokens)} schema ·{" "}
                      {mcpSchemaTokens(m.id).measured ? "measured" : "estimate"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">Skip if {m.skipIf}</p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={() => store.toggleMcp(m.id)}
                    aria-label={m.name}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-10 rounded-[24px] bg-card p-5 shadow-[var(--shadow-border)] sm:p-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-steel">Leanness checklist</h2>
        <p className="mt-2 font-mono text-2xl tabular text-paper">
          {b.leanScore}
          <span className="ml-2 text-sm text-muted-foreground">
            {b.checks.filter((c) => c.pass).length}/{b.checks.length} checks
          </span>
        </p>
        <ul className="mt-4 space-y-2">
          {b.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span aria-hidden>{c.pass ? "✓" : "✗"}</span>
              <span className={c.pass ? "" : "text-warn"}>{c.label}</span>
            </li>
          ))}
        </ul>
        {b.estimates.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Estimates inside these numbers
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {b.estimates.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{b.method}</p>
      </section>
    </Shell>
  );
}
