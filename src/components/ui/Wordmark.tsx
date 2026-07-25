import { cn } from '@/lib/utils';

/**
 * The ABNIYAH wordmark — always all-caps, set in Sora (loaded in index.html)
 * with wide tracking. Pass size/color via className; weight and spacing live
 * here so the brand renders identically everywhere.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('font-semibold tracking-[0.18em] leading-none', className)}
      style={{ fontFamily: "'Sora', 'Segoe UI', system-ui, sans-serif" }}
    >
      ABNIYAH
    </span>
  );
}
