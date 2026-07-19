interface LogoProps {
  size?: number;
  className?: string;
  /** Use on dark teal / brand-panel backgrounds — inverts to white */
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
      className={className}
      style={variant === 'white' ? { filter: 'brightness(0) invert(1)', opacity: 0.9 } : undefined}
    />
  );
}
