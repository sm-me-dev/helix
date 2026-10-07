import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/evals")({ component: EvalsPage });

type EvalRow = {
  cell: string;
  runs: number;
  passed: number;
  avgWallSec: number;
  avgTokens: number | null;
};

type EvalReport = {
  meta: { agent: string; arms: string[]; runs: number; startedAt: string; tasks: string[] };
  rows: EvalRow[];
};

const REPORTS = import.meta.glob<{ default: EvalReport }>("../../evals/results/*.json", {
  eager: true,
});

function EvalsPage() {
  const reports = Object.entries(REPORTS).map(([path, mod]) => ({
    name: path.split("/").pop() ?? path,
    ...mod.default,
  }));

  return (
    <Shell>
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Evals</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
          Measured, not simulated.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Head-to-head task runs with and without the pack, graded by each task&apos;s pass
          command. Only committed JSON reports appear below — never the /run simulation.
          Token and cost cells read “n/a” when the agent doesn&apos;t report them; they are
          never invented. See <span className="font-mono">evals/README.md</span> to run your
          own.
        </p>
      </header>

      {reports.length === 0 ? (
        <p className="mt-8 rounded-2xl bg-card p-5 text-sm text-muted-foreground shadow-[var(--shadow-border)]">
          No real eval reports committed yet. The simulation on{" "}
          <Link to="/run" className="underline underline-offset-2">
            /run
          </Link>{" "}
          is illustrative until one lands here.
        </p>
      ) : (
        reports.map((r) => (
          <section
            key={r.name}
            className="mt-8 rounded-[24px] bg-card p-5 shadow-[var(--shadow-border)] sm:p-6"
          >
            <h2 className="font-mono text-sm text-paper">{r.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.meta.agent} · {r.meta.startedAt} · {r.meta.runs} run(s) · arms:{" "}
              {r.meta.arms.join(", ")} · tasks: {r.meta.tasks.join(", ")}
            </p>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">cell</th>
                  <th className="py-1 pr-3 font-medium">runs</th>
                  <th className="py-1 pr-3 font-medium">passed</th>
                  <th className="py-1 pr-3 font-medium">avg wall (s)</th>
                  <th className="py-1 font-medium">avg tokens</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.cell} className="border-t border-border font-mono text-[13px]">
                    <td className="py-1.5 pr-3">{row.cell}</td>
                    <td className="py-1.5 pr-3">{row.runs}</td>
                    <td className="py-1.5 pr-3">{row.passed}</td>
                    <td className="py-1.5 pr-3">{row.avgWallSec}</td>
                    <td className="py-1.5">{row.avgTokens ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </Shell>
  );
}
