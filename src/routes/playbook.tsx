import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Switch } from "@/components/ui/switch";
import { PRACTICES } from "@/lib/harness/practices";
import { useHarness } from "@/lib/store";

export const Route = createFileRoute("/playbook")({ component: PlaybookPage });

function PlaybookPage() {
  const store = useHarness();
  const chapters = [...new Set(PRACTICES.map((p) => p.chapter))];

  return (
    <Shell>
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Playbook</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
          The harness is the product.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Agent = model + harness. These rails are what 2026 actually converged on — AGENTS.md as a
          checklist, skills as progressive disclosure, Graphify instead of grep, hooks instead of
          hoping the model remembers prettier.
        </p>
      </header>

      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <Flag
          label="Graph-first context"
          hint="Query Graphify before glob/grep/wide Read"
          checked={store.graphFirst}
          onChange={(v) => store.setFlag("graphFirst", v)}
        />
        <Flag
          label="Progressive disclosure"
          hint="Short AGENTS.md, skills on demand"
          checked={store.progressiveDisclosure}
          onChange={(v) => store.setFlag("progressiveDisclosure", v)}
        />
        <Flag
          label="Default to one agent"
          hint="Fan out only when work is uncoupled"
          checked={store.defaultSingleAgent}
          onChange={(v) => store.setFlag("defaultSingleAgent", v)}
        />
        <Flag
          label="Hooks over prompts"
          hint="Format, lint, deny .env mechanically"
          checked={store.hooksEnabled}
          onChange={(v) => store.setFlag("hooksEnabled", v)}
        />
      </section>

      {chapters.map((ch) => (
        <section key={ch} className="mt-12">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-steel">{ch}</h2>
          <ul className="mt-4 grid gap-4">
            {PRACTICES.filter((p) => p.chapter === ch).map((p) => (
              <li
                key={p.id}
                className="rounded-[24px] bg-card p-5 shadow-[var(--shadow-border)] sm:p-6"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-display text-2xl tracking-tight">{p.title}</h3>
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
                    title={
                      p.confidence === "verified"
                        ? "Checked against the primary source on 2026-10-07"
                        : p.confidence === "reported"
                          ? "Repeated from a secondary synthesis; primary not confirmed"
                          : "Guidance from practice; do not quote as a finding"
                    }
                  >
                    {p.confidence}
                  </span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed">{p.rule}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.why}</p>
                {p.sources.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.sources.map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mr-3 underline decoration-dotted underline-offset-2"
                      >
                        {s.title}
                      </a>
                    ))}
                  </p>
                )}
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-signal">Do</dt>
                    <dd className="mt-1 text-sm leading-relaxed">{p.doThis}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-warn">Don’t</dt>
                    <dd className="mt-1 text-sm leading-relaxed">{p.notThis}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Shell>
  );
}

function Flag({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-card px-4 py-3 shadow-[var(--shadow-border)]">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
