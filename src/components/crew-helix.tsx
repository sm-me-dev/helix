import { Link } from "@tanstack/react-router";
import { CREW } from "@/lib/harness/crew";
import type { CrewId } from "@/lib/harness/types";
import { cn } from "@/lib/utils";

export function CrewHelix({
  active,
  enabled,
  onPick,
  compact = false,
}: {
  active?: CrewId | "system" | null;
  enabled?: CrewId[];
  onPick?: (id: CrewId) => void;
  compact?: boolean;
}) {
  const on = new Set(enabled ?? CREW.map((c) => c.id));

  return (
    <ol className={cn("relative", compact ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" : "flex flex-col gap-0")}>
      {!compact && (
        <div
          aria-hidden
          className="absolute top-4 bottom-4 left-[19px] w-px bg-border sm:left-[23px]"
        />
      )}
      {CREW.map((role, i) => {
        const isOn = on.has(role.id);
        const isActive = active === role.id;
        const inner = (
          <div
            className={cn(
              "relative flex gap-4 rounded-2xl p-3 sm:p-4",
              compact ? "flex-col items-start bg-card shadow-[var(--shadow-border)]" : "items-start",
              isActive && "bg-card shadow-[var(--shadow-border)]",
              !isOn && "opacity-40",
            )}
          >
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] sm:size-10",
                isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-steel",
              )}
            >
              {role.step}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {role.verb}
              </p>
              <p className={cn("font-display text-lg leading-tight", compact ? "text-base" : "sm:text-xl")}>
                {role.name}
              </p>
              {!compact && (
                <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {role.oneLiner}
                </p>
              )}
            </div>
          </div>
        );

        if (onPick) {
          return (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => onPick(role.id)}
                className="w-full text-left"
              >
                {inner}
              </button>
            </li>
          );
        }

        return (
          <li key={role.id}>
            <Link to="/crew" hash={role.id} className="block">
              {inner}
            </Link>
            {!compact && i < CREW.length - 1 && <div className="h-1" />}
          </li>
        );
      })}
    </ol>
  );
}
