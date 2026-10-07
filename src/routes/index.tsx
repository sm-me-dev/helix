import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { CrewHelix } from "@/components/crew-helix";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { Shell } from "@/components/shell";
import { Term } from "@/components/term";
import { Button } from "@/components/ui/button";
import { PLATFORMS } from "@/lib/harness/platforms";
import { SAMPLE_ISSUE } from "@/lib/harness/simulation";
import { breakdown, formatTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Studio });

function Studio() {
  const crew = useHarness((s) => s.crew);
  const store = useHarness();
  const config = selectConfig(store);
  const b = breakdown(config);
  const ratio = (b.naiveAlwaysOn / Math.max(b.alwaysOn, 1)).toFixed(1);

  return (
    <Shell>
      <div className="stagger-in grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14">
        <section className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.22em] text-steel">
            Universal coding harness
          </p>
          <h1 className="mt-3 font-display text-[2.35rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl lg:text-[3.35rem]">
            A crew for every agent. Fewer tokens. Better diffs.
          </h1>
          <p className="mt-5 max-w-[38rem] text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
            Helix is a drop-in harness for Claude Code, Cursor, Codex, Gemini, Copilot, and the rest
            of the AGENTS.md family. Six specialized roles, Graphify-first context, skills that load
            on demand — tuned so the model spends attention on the change, not the repo.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/run">
                Run LED-1841
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/export">Export the pack</Link>
            </Button>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-3 sm:gap-5">
            <Stat
              k="Always-on"
              term="Tokens loaded on every turn, before the task is known. Lower is cheaper."
              v={formatTokens(b.alwaysOn)}
              hint={`vs ${formatTokens(b.naiveAlwaysOn)} fixture baseline`}
            />
            <Stat
              k="Lean score"
              term="Share of leanness checks passing — full checklist on /stack. Counts use an o200k_base approximation."
              v={String(b.leanScore)}
              hint={`${b.checks.filter((c) => c.pass).length}/${b.checks.length} checks · ${ratio}× lighter`}
            />
            <Stat k="Agents" v={String(PLATFORMS.length)} hint="same AGENTS.md" />
          </dl>
        </section>

        <section className="rounded-[28px] bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Graphify · {SAMPLE_ISSUE.repo}
            </p>
            <p className="font-mono text-[11px] text-steel">query, don’t grep</p>
          </div>
          <KnowledgeGraph />
        </section>
      </div>

      <section className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-steel">The crew</p>
          <h2 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
            One conductor. Five specialists. Isolated windows.
          </h2>
          <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            The parent does not implement. Scout reads what the graph cites. Architect decides.
            Builder patches the plan’s files. Prover runs the repo’s tests. Auditor never shares a
            context window with Builder — that is the whole point.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <Link to="/crew">
              Design the crew
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <CrewHelix enabled={crew} compact />
      </section>

      <section className="mt-16 rounded-[28px] bg-card px-5 py-8 shadow-[var(--shadow-border)] sm:px-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-steel">2026 rails</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">
          Earn each line. Strip each tool.
        </h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-3">
          <Rail
            title="Progressive disclosure"
            body="AGENTS.md is a table of contents. Skill bodies and references open only when the task needs them."
          />
          <Rail
            title="Four MCPs, not twenty"
            body="Graphify, Context7, Playwright. GitHub only with a tight toolset. Schema tokens are paid every turn."
          />
          <Rail
            title="Hooks over hopes"
            body="Format, lint, and .env denies are mechanical. Prompts keep naming and architecture intent."
          />
        </ul>
      </section>
    </Shell>
  );
}

function Stat({ k, v, hint, term }: { k: string; v: string; hint: string; term?: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-3 shadow-[var(--shadow-border)] sm:px-4 sm:py-4">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {term ? <Term definition={term}>{k}</Term> : k}
      </dt>
      <dd className="mt-1 font-mono text-xl tabular text-paper sm:text-2xl">{v}</dd>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Rail({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
