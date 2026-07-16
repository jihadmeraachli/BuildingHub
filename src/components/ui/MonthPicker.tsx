import { useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MonthPickerProps {
  value: string;           // 'YYYY-MM' or ''
  onChange: (v: string) => void;
  className?: string;
}

export function MonthPicker({ value, onChange, className }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() =>
    value ? parseInt(value.slice(0, 4)) : new Date().getFullYear()
  );

  const selYear  = value ? parseInt(value.slice(0, 4))      : null;
  const selMonth = value ? parseInt(value.slice(5, 7)) - 1  : null; // 0-indexed

  function pick(idx: number) {
    onChange(`${viewYear}-${String(idx + 1).padStart(2, '0')}`);
    setOpen(false);
  }

  function thisMonth() {
    const n = new Date();
    onChange(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`);
    setOpen(false);
  }

  function clear() {
    onChange('');
    setOpen(false);
  }

  const nowYear  = new Date().getFullYear();
  const nowMonth = new Date().getMonth();

  const label = value
    ? new Date(value + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Pick a month';

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button className={cn(
          'inline-flex items-center gap-2 rounded-xl border border-border bg-background text-foreground px-3 py-2.5 text-sm cursor-pointer transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring/50',
          className
        )}>
          <CalendarDays size={15} className="text-muted-foreground" />
          {label}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 w-60 rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl p-4 outline-none"
        >
          {/* Year nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setViewYear(y => y - 1)}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition cursor-pointer"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold">{viewYear}</span>
            <button
              onClick={() => setViewYear(y => y + 1)}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition cursor-pointer"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {MONTHS.map((m, idx) => {
              const isSelected = selYear === viewYear && selMonth === idx;
              const isCurrent  = nowYear  === viewYear && nowMonth  === idx;
              return (
                <button
                  key={m}
                  onClick={() => pick(idx)}
                  className={cn(
                    'py-1.5 rounded-lg text-sm font-medium transition cursor-pointer',
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : isCurrent
                      ? 'bg-primary/15 text-primary'
                      : 'text-foreground hover:bg-primary/10 hover:text-primary'
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <button
              onClick={thisMonth}
              className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition cursor-pointer"
            >
              This month
            </button>
            <button
              onClick={clear}
              className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition cursor-pointer"
            >
              Clear
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
