import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline jargon with a native tooltip. Keeps labels short without losing meaning. */
export function Term({
  children,
  definition,
  className,
}: {
  children: ReactNode;
  definition: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "underline decoration-dotted decoration-muted-foreground/60 underline-offset-2",
        className,
      )}
      title={definition}
    >
      {children}
    </span>
  );
}
