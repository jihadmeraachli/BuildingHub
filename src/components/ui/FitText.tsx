import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A single line that shrinks its font instead of truncating or wrapping.
 *
 * Built for money. A 2-up stat grid on a phone leaves about 150px per tile,
 * and "$13,700.00" at text-2xl does not fit, so tiles used to show "$13,70…"
 * (useless) or wrap the minus onto its own line (worse). The number is the
 * whole point of the tile; the type size is negotiable. The font scales down
 * to `min` of its CSS size until the line fits, and grows back when the tile
 * widens (rotation, sidebar collapse). Nothing is ever cut.
 */
export function FitText({ children, className, min = 0.55 }: { children: ReactNode; className?: string; min?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = outer.current, text = inner.current;
    if (!box || !text) return;
    const fit = () => {
      // Measure at full size, then jump straight to the ratio that fits.
      text.style.fontSize = '';
      const avail = box.clientWidth, need = text.scrollWidth;
      if (avail <= 0 || need <= 0) return;
      const next = need > avail ? Math.max(min, avail / need) : 1;
      setScale(Math.floor(next * 100) / 100);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [children, min]);

  return (
    <div ref={outer} className={cn('min-w-0 w-full overflow-hidden', className)}>
      <span ref={inner} className="inline-block whitespace-nowrap align-baseline" style={{ fontSize: scale < 1 ? `${scale}em` : undefined }}>
        {children}
      </span>
    </div>
  );
}
