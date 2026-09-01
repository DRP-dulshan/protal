import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        outline: "border-[var(--border)] text-[var(--foreground)]",
        success:
          "border-transparent bg-[var(--success)]/12 text-[var(--success)]",
        warning:
          "border-transparent bg-[var(--warning)]/18 text-[var(--warning-foreground)] dark:text-[var(--warning)]",
        danger:
          "border-transparent bg-[var(--destructive)]/12 text-[var(--destructive)]",
        brand:
          "border-transparent bg-[var(--brand)]/18 text-[var(--brand-foreground)] dark:text-[var(--brand)]",
        muted:
          "border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
