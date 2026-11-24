// @env browser
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps, JSX } from "react";

const alertVariants = cva(
  "grid w-full gap-1 rounded-2xl border px-4 py-3 text-left text-sm has-[>svg]:grid-cols-[auto_minmax(0,1fr)] has-[>svg]:gap-x-2.5 *:[svg]:size-4 *:[svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        warning: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
        destructive: "border-destructive/25 bg-destructive/5 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>): JSX.Element {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return <div data-slot="alert-title" className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="alert-description"
      className={cn("min-w-0 text-xs leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}
