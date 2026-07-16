import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-white dark:bg-destructive/60",
        outline:     "border-border text-foreground",
        green:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
        red:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
        yellow:      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
        slate:       "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        indigo:      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
        blue:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        orange:      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
        violet:      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
        sky:         "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeColor = "green" | "red" | "yellow" | "slate" | "indigo" | "blue" | "orange" | "violet" | "sky"

function Badge({
  className,
  variant,
  color,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    color?: BadgeColor
  }) {
  const Comp = asChild ? Slot.Root : "span"
  const resolvedVariant = color ?? variant ?? "default"

  return (
    <Comp
      data-slot="badge"
      data-variant={resolvedVariant}
      className={cn(badgeVariants({ variant: resolvedVariant as VariantProps<typeof badgeVariants>["variant"] }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
