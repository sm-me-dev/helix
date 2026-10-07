import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { generatePack, packAsText, type PackFile } from "@/lib/harness/generate";
import { PLATFORMS } from "@/lib/harness/platforms";
import type { PlatformId } from "@/lib/harness/types";
import { breakdown, formatTokens } from "@/lib/harness/tokens";
import { selectConfig, useHarness } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/export")({ component: ExportPage });

function ExportPage() {
  const store = useHarness();
  const config = selectConfig(store);
  const files = useMemo(() => generatePack(config), [config]);
  const [active, setActive] = useState("AGENTS.md");
  const file = files.find((f) => f.path === active) ?? files[0];
  const b = breakdown(config);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      toast.success("Copied");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      toast.error("Clipboard blocked — select the preview and copy");
    }
  }

  function downloadAll() {
    const blob = new Blob([packAsText(files)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "helix-pack.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadFile(f: PackFile) {
    const blob = new Blob([f.body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.path.split("/").at(-1) ?? "file.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] uppercase tracking-[0.22em] text-steel">Export</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
            One pack. Every agent.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            AGENTS.md is the source. Vendor files are pointers so they cannot drift. Drop the pack
            at a repo root, run <span className="font-mono text-foreground">graphify install</span>,
            then <span className="font-mono text-foreground">/graphify .</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => copy(packAsText(files), "all")}>
            {copied === "all" ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy pack
          </Button>
          <Button variant="outline" onClick={downloadAll}>
            <Download className="size-4" />
            Download
          </Button>
          <Button variant="ghost" onClick={() => store.reset()}>
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </div>
      </header>

      <p className="mt-6 font-mono text-sm tabular text-steel">
        {files.length} files · always-on {formatTokens(b.alwaysOn)} · lean {b.leanScore}
      </p>

      <section className="mt-6">
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Platforms</p>
        <ul className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const on = store.platforms.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => store.togglePlatform(p.id as PlatformId)}
                  className={cn(
                    "min-h-11 rounded-full px-3.5 text-sm transition-[background-color,color] duration-150 ease-out",
                    on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {p.name}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
        <ul className="max-h-[32rem] overflow-y-auto rounded-[24px] bg-card p-2 shadow-[var(--shadow-border)]">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => setActive(f.path)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left font-mono text-[12px]",
                  f.path === file.path ? "bg-secondary text-paper" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rounded-[24px] bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate font-mono text-[12px] text-steel">{file.path}</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => copy(file.body, file.path)}>
                {copied === file.path ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => downloadFile(file)}>
                <Download className="size-3.5" />
              </Button>
            </div>
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90">
            {file.body}
          </pre>
        </div>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Edit the crew, stack, and playbook rails — this pack regenerates immediately. Lean score
        lives in the header.
      </p>
    </Shell>
  );
}
