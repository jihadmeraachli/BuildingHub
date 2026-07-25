import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  className?: string;
  variant?: 'default' | 'white';
}

/**
 * The Abniyah mark. The geometry comes from the designed asset
 * (public/logo-mask.png — Canva export used as an alpha stencil); the color is
 * painted THROUGH it in CSS, so one file serves every context with no filters:
 *   default → the brand gradient (deep teal crown → sage base)
 *   white   → solid white, for the login gradient panel
 * If the gradient changes, mirror it in the logo-prep script outputs
 * (logo-color.png / favicon.png) so the favicon stays in sync.
 */
const BRAND_GRADIENT = 'linear-gradient(160deg, #0F4A3F 0%, #3E7A6C 50%, #B9D2CB 100%)';

export function Logo({ size = 32, className, variant = 'default' }: LogoProps) {
  return (
    <span
      role="img"
      aria-label="Abniyah"
      className={cn('inline-block shrink-0 select-none', className)}
      style={{
        width: size,
        height: size,
        background: variant === 'white' ? '#ffffff' : BRAND_GRADIENT,
        WebkitMaskImage: 'url(/logo-mask.png)',
        maskImage: 'url(/logo-mask.png)',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
