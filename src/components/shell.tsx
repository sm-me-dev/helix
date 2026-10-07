import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  Boxes,
  Download,
  Play,
  Radio,
  Users,
} from "lucide-react";
import { type ReactNode } from "react";
import { Toaster } from "sonner";
import { HelixMark } from "@/components/mark";
import { LeanBadge, TokenMeter } from "@/components/token-meter";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Studio", icon: Radio },
  { to: "/crew", label: "Crew", icon: Users },
  { to: "/stack", label: "Stack", icon: Boxes },
  { to: "/playbook", label: "Playbook", icon: BookOpen },
  { to: "/run", label: "Run", icon: Play },
  { to: "/export", label: "Export", icon: Download },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 pr-1">
            <HelixMark className="size-6" />
            <span className="font-display text-xl tracking-tight">Helix</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const on = item.to === "/" ? pathname === "/" : pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm transition-[color,background-color] duration-150 ease-out",
                    on
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto hidden items-center gap-5 lg:flex">
            <LeanBadge />
            <div className="w-44">
              <TokenMeter compact />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-12">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-md md:hidden">
        <ul className="grid grid-cols-6">
          {NAV.map((item) => {
            const on = item.to === "/" ? pathname === "/" : pathname === item.to;
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] tracking-wide",
                    on ? "text-paper" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.6} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-card)",
            color: "var(--color-foreground)",
            border: "1px solid var(--color-border)",
          },
        }}
      />
    </div>
  );
}
