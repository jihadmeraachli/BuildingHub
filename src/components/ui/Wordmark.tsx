import { cn } from '@/lib/utils';

/**
 * The ABNIYAH wordmark — always all-caps, set in Sora (loaded in index.html)
 * with wide tracking. Pass size/color via className; weight and spacing live
 * here so the brand renders identically everywhere.
 *
 * `byline` renders "Product of Tatawwor" underneath — the public brand↔legal-
 * entity link (also evidence for reviewers, e.g. Meta's display-name check).
 * Use it on brand moments (gate, login); leave it off in the app chrome.
 */
export function Wordmark({ className, byline = false }: { className?: string; byline?: boolean }) {
  const mark = (
    <span
      className={cn('font-semibold tracking-[0.18em] leading-none', className)}
      style={{ fontFamily: "'Sora', 'Segoe UI', system-ui, sans-serif" }}
    >
      ABNIYAH
    </span>
  );
  if (!byline) return mark;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {mark}
      <span className="text-[9px] font-medium tracking-[0.08em] leading-none opacity-60">
        Product of Tatawwor
      </span>
    </span>
  );
}
