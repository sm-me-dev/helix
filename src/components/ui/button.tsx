import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-disabled:scale-[0.96] transition-[scale,background-color,color,box-shadow,opacity] duration-150 ease-out",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-paper/90",
        outline:
          "bg-transparent text-foreground shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)] hover:bg-secondary",
        ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary",
        signal: "bg-signal/15 text-signal hover:bg-signal/25",
      },
      size: {
        default: "h-11 rounded-[10px] px-4 text-sm",
        sm: "h-9 rounded-lg px-3 text-[13px]",
        lg: "h-12 rounded-xl px-5 text-sm",
        icon: "size-11 rounded-[10px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
