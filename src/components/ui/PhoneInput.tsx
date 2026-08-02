import { useEffect, useState } from 'react';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';

/**
 * Phone entry with an explicit country code (#66): a code dropdown (default
 * 🇱🇧 +961) + the local number. Stores one string ("+961 3 123 456") into the
 * existing phone columns, so waPhone() normalization and WhatsApp keep working
 * unchanged. Lebanon-first list, diaspora-friendly.
 */
const CODES: ReadonlyArray<readonly [string, string]> = [
  ['+961', '🇱🇧'], ['+971', '🇦🇪'], ['+966', '🇸🇦'], ['+974', '🇶🇦'], ['+965', '🇰🇼'],
  ['+973', '🇧🇭'], ['+962', '🇯🇴'], ['+963', '🇸🇾'], ['+964', '🇮🇶'], ['+20', '🇪🇬'],
  ['+90', '🇹🇷'], ['+357', '🇨🇾'], ['+33', '🇫🇷'], ['+49', '🇩🇪'], ['+46', '🇸🇪'],
  ['+44', '🇬🇧'], ['+1', '🇺🇸'], ['+61', '🇦🇺'], ['+55', '🇧🇷'], ['+234', '🇳🇬'],
];

/** Split a stored value into code + local. Bare local numbers ("03 123 456")
 *  are treated as Lebanese — matches waPhone()'s Lebanon-first assumption. */
function splitPhone(value: string | null | undefined): { code: string; local: string } {
  const v = (value ?? '').trim();
  if (!v) return { code: '+961', local: '' };
  const normalized = v.startsWith('00') ? `+${v.slice(2)}` : v;
  if (normalized.startsWith('+')) {
    const byLength = CODES.map((c) => c[0]).sort((a, b) => b.length - a.length);
    const hit = byLength.find((c) => normalized.startsWith(c));
    if (hit) return { code: hit, local: normalized.slice(hit.length).trim() };
    return { code: '+961', local: normalized.replace(/^\+/, '').trim() };
  }
  return { code: '+961', local: v };
}

interface PhoneInputProps {
  label?: string;
  value: string;
  onChange: (full: string) => void;
  placeholder?: string;
}

export function PhoneInput({ label, value, onChange, placeholder = '3 123 456' }: PhoneInputProps) {
  const parsed = splitPhone(value);
  // The code stays sticky while the local part is empty (picking +971 before
  // typing must not snap back to +961 on the next render).
  const [code, setCode] = useState(parsed.code);
  useEffect(() => {
    if (value && parsed.code !== code) setCode(parsed.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const compose = (c: string, l: string) => (l.trim() ? `${c} ${l.trim()}` : '');

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <div className="flex gap-2" dir="ltr">
        <RadixSelect value={code} onValueChange={(c) => { setCode(c); if (parsed.local) onChange(compose(c, parsed.local)); }}>
          <SelectTrigger className="w-30 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODES.map(([c, flag]) => (
              <SelectItem key={c} value={c}>{flag} {c}</SelectItem>
            ))}
          </SelectContent>
        </RadixSelect>
        <input
          type="tel"
          value={parsed.local}
          onChange={(e) => onChange(compose(code, e.target.value))}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </div>
  );
}
