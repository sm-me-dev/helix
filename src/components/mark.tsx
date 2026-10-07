import { cn } from "@/lib/utils";

export function HelixMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("text-paper", className)}
      aria-hidden="true"
    >
      <path
        d="M7 3c4 3.2 6 5.8 6 9s-2 5.8-6 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17 3c-4 3.2-6 5.8-6 9s2 5.8 6 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
    </svg>
  );
}
