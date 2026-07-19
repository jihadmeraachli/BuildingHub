import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  className?: string;
  /** 'white' = on dark/teal panels; 'default' = adapts to light/dark theme */
  variant?: 'default' | 'white';
}

export function Logo({ size = 32, className, variant = 'default' }: LogoProps) {
  return (
    <img
      src="/logo-mark.png"
      width={size}
      height={size}
      alt="Abniyah"
      draggable={false}
      className={cn(
        // Remove the white PNG background via blend modes:
        // • multiply on light bg → white pixels vanish, building shows naturally
        // • screen + invert(1) on dark bg → white bg vanishes, building appears bright
        variant === 'white'
          ? '[mix-blend-mode:screen] [filter:invert(1)]'
          : '[mix-blend-mode:multiply] dark:[mix-blend-mode:screen] dark:[filter:invert(1)]',
        className,
      )}
    />
  );
}
