import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  className?: string;
  variant?: 'default' | 'white';
}

export function Logo({ size = 32, className, variant = 'default' }: LogoProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg font-bold shrink-0 select-none',
        variant === 'white' ? 'bg-white/25 text-white' : 'bg-primary text-primary-foreground',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      AB
    </div>
  );
}
