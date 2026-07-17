import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectOption { value: string; label: string; }

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];          // [] means "all / none filtered"
  onChange: (v: string[]) => void;
  allLabel?: string;
  className?: string;
}

export function MultiSelect({ options, value, onChange, allLabel = 'All', className }: MultiSelectProps) {
  const [open, setOpen] = useState(false);

  const isAll = value.length === 0;

  function toggle(v: string) {
    const next = value.includes(v) ? value.filter(x => x !== v) : [...value, v];
    onChange(next.length === options.length ? [] : next); // all checked = same as none
  }

  const triggerLabel = isAll
    ? allLabel
    : value.length === 1
      ? (options.find(o => o.value === value[0])?.label ?? value[0])
      : `${value.length} blocks`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 h-9 rounded-md border border-input bg-background px-3 text-sm',
            'hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )}
        >
          <span className="truncate max-w-[150px]">{triggerLabel}</span>
          <ChevronDown size={13} className={cn('text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {/* All option */}
        <button
          onClick={() => { onChange([]); setOpen(false); }}
          className={cn(
            'flex w-full items-center gap-2 rounded px-3 py-2 text-sm transition-colors text-start',
            isAll ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-accent'
          )}
        >
          <span className="flex-1">{allLabel}</span>
          {isAll && <Check size={13} />}
        </button>
        <div className="my-1 border-t border-border" />
        {options.map(opt => {
          const checked = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-3 py-2 text-sm transition-colors text-start',
                checked ? 'bg-primary/15 text-primary' : 'hover:bg-accent'
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border transition-colors',
                  checked && 'bg-primary border-primary'
                )}
              >
                {checked && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
              </span>
              <span className="flex-1 truncate">{opt.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
