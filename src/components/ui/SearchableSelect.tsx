import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface SearchableOption {
  value: string;
  label: string;
}

/**
 * A dropdown that can be typed into — same visual language as the Radix
 * select (bordered trigger, chevron, check on selected), but backed by a
 * command palette so long lists (many entities/blocks) stay usable.
 */
export function SearchableSelect({
  options, value, onChange,
  placeholder = '—',
  searchPlaceholder = '',
  emptyText = '—',
  className,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const labelByValue = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 cursor-pointer',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[240px]"
      >
        <Command
          // Filter on the LABEL, not the (uuid) value.
          filter={(v, search) => ((labelByValue.get(v) ?? '').toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map(o => (
              <CommandItem
                key={o.value}
                value={o.value}
                onSelect={(v) => { onChange(v); setOpen(false); }}
              >
                <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} />
                {o.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
