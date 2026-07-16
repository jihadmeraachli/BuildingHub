import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

type InputProps = React.ComponentProps<"input"> & {
  label?: string
  error?: string
}

function Input({ className, type, label, id, error, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-")
  const el = (
    <input
      type={type}
      id={inputId}
      data-slot="input"
      aria-invalid={error ? true : undefined}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
  if (!label && !error) return el
  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label htmlFor={inputId}>{label}</Label>}
      {el}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export { Input }
