import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LEBANON_CITIES } from '@/lib/locationData';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

/**
 * The one city picker for the whole app — every city field must use this so the
 * stored values stay consistent enough to group in reports.
 *
 * Two things it does that the generic SearchableSelect cannot:
 *  - The list is ~3,500 places, so it filters itself and renders only the top
 *    matches. Handing all of them to cmdk renders 3,500 nodes on every open.
 *  - A value saved before this list existed (or from the old 73-name list) is
 *    kept selectable instead of silently showing as blank.
 */
const MAX_SHOWN = 60;

export function CitySelect({
  label, value, onChange, className, required,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // A legacy/unknown value stays valid — never silently drop what is on record.
  const isLegacy = !!value && !LEBANON_CITIES.includes(value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = isLegacy ? [value, ...LEBANON_CITIES] : LEBANON_CITIES;
    if (!q) return pool.slice(0, MAX_SHOWN);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const c of pool) {
      const lc = c.toLowerCase();
      if (lc.startsWith(q)) starts.push(c);
      else if (lc.includes(q)) contains.push(c);
      if (starts.length >= MAX_SHOWN) break;
    }
    return [...starts, ...contains].slice(0, MAX_SHOWN);
  }, [query, isLegacy, value]);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-sm font-medium text-muted-foreground">
          {label}{required && <span className="text-destructive"> *</span>}
        </label>
      )}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary cursor-pointer',
              !value && 'text-muted-foreground',
            )}
          >
            <span className="truncate">{value || t('common.selectCity')}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[260px]">
          {/* We filter above, so cmdk must not filter again. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t('common.searchCity')}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{t('common.noCityMatch')}</CommandEmpty>
              {shown.map((c) => (
                <CommandItem key={c} value={c} onSelect={() => { onChange(c); setOpen(false); setQuery(''); }}>
                  <Check className={cn('size-4', c === value ? 'opacity-100' : 'opacity-0')} />
                  {c}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
