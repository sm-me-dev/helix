import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrewHelix } from "@/components/crew-helix";
import { Shell } from "@/components/shell";
import { Switch } from "@/components/ui/switch";
import { CREW_BY_ID } from "@/lib/harness/crew";
import { SKILL_BY_ID } from "@/lib/harness/skills";
import type { CrewId } from "@/lib/harness/types";
import { useHarness } from "@/lib/store";

export const Route = createFileRoute("/crew")({ component: CrewPage });

function CrewPage() {
  const crew = useHarness((s) => s.crew);
  const toggle = useHarness((s) => s.toggleCrew);
  const [picked, setPicked] = useState<CrewId>("conductor");
  const role = CREW_BY_ID[picked];
  const on = crew.includes(picked);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as CrewId;
    if (CREW_BY_ID[hash]) setPicked(hash);
  }, []);

  return (
    <Shell>
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Crew</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
          Dispatch, don’t pile on.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Each role is a new loop with its own window. The parent keeps a one-sentence description
          so it can choose whom to send. The body loads only when that role runs.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <CrewHelix active={picked} enabled={crew} onPick={setPicked} />

        <article className="rounded-[28px] bg-card p-5 shadow-[var(--shadow-border)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] text-steel">
                {role.step} · {role.verb}
              </p>
              <h2 className="mt-1 font-display text-3xl">{role.name}</h2>
            </div>
            <label className="flex min-h-11 items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {role.required ? "Always on" : on ? "Enabled" : "Off"}
              </span>
              <Switch
                checked={on}
                disabled={role.required}
                onCheckedChange={() => toggle(role.id)}
                aria-label={`Toggle ${role.name}`}
              />
            </label>
          </div>
          <p className="mt-4 text-[15px] leading-relaxed text-foreground/90">{role.job}</p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <Fact k="When" v={role.when} />
            <Fact k="Skip" v={role.skipWhen} />
            <Fact k="Input" v={role.input} />
            <Fact k="Output" v={role.output} />
          </dl>
          <div className="mt-6">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Skills</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {role.skills.map((id) => (
                <li
                  key={id}
                  className="rounded-full bg-secondary px-3 py-1 font-mono text-[12px] text-steel"
                >
                  {SKILL_BY_ID[id].name}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 font-mono text-[12px] text-muted-foreground">
            Isolated: {role.isolated ? "yes — summary only returns" : "no — lives in the parent"}
            <span className="mx-2 text-border">·</span>
            Always-on index: {role.alwaysOnTokens} tokens
          </p>
        </article>
      </div>
    </Shell>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{v}</dd>
    </div>
  );
}
