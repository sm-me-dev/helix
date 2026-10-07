import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Switch } from "@/components/ui/switch";
import { LSPS } from "@/lib/harness/lsps";
import { MCPS } from "@/lib/harness/mcps";
import { SKILLS } from "@/lib/harness/skills";
import { breakdown, formatTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stack")({ component: StackPage });

const TABS = ["Skills", "MCP", "LSP"] as const;

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
            Vercel stripped 80% of an agent’s tools and watched success go up while tokens halved.
            Helix defaults to Graphify, Context7, and Playwright. Everything else is opt-in.
          </p>
        </div>
        <p className="font-mono text-sm tabular text-steel">
          schemas {formatTokens(b.mcpSchemas + b.lspSchemas)}
          <span className="text-muted-foreground"> always-on {formatTokens(b.alwaysOn)}</span>
        </p>
      </header>

      {mcpWarn && (
        <p className="mt-6 rounded-2xl bg-warn/10 px-4 py-3 text-sm text-warn">
          More than five MCPs. Schema tokens sit in every turn — disable anything this repo will not call.
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
              tab === t ? "bg-card text-foreground shadow-[var(--shadow-border)]" : "text-muted-foreground",
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
              <li key={s.id} className="rounded-2xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm text-paper">{s.name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                    <p className="mt-2 font-mono text-[11px] text-steel">
                      {s.alwaysOnTokens} index · {s.bodyTokens} body on demand · {s.loadsWhen}
                    </p>
                  </div>
                  <Switch checked={on} onCheckedChange={() => store.toggleSkill(s.id)} aria-label={s.name} />
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
              <li key={m.id} className="rounded-2xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="font-medium">{m.name}</h2>
                      <span className="font-mono text-[11px] text-muted-foreground">{m.maintainer}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{m.job}</p>
                    <p className="mt-2 font-mono text-[11px] text-steel">
                      {m.tools.join(" · ")} · {formatTokens(m.schemaTokens)} schema
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">Skip if {m.skipIf}</p>
                  </div>
                  <Switch checked={on} onCheckedChange={() => store.toggleMcp(m.id)} aria-label={m.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "LSP" && (
        <ul className="mt-6 grid gap-3">
          {LSPS.map((l) => {
            const on = store.lsps.includes(l.id);
            return (
              <li key={l.id} className="rounded-2xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-medium">{l.name}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{l.job}</p>
                    <p className="mt-2 font-mono text-[11px] text-steel">
                      {l.languages.join(" · ")} · {l.schemaTokens} tokens
                    </p>
                  </div>
                  <Switch checked={on} onCheckedChange={() => store.toggleLsp(l.id)} aria-label={l.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
