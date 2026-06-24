import type { ReactNode } from 'react';

type Color = 'blue' | 'green' | 'yellow' | 'red' | 'slate' | 'orange';

interface BadgeProps {
  color?: Color;
  children: ReactNode;
}

const colorClasses: Record<Color, string> = {
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red: 'bg-red-100 text-red-800',
  slate: 'bg-slate-100 text-slate-700',
  orange: 'bg-orange-100 text-orange-800',
};

export function Badge({ color = 'slate', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClasses[color]}`}>
      {children}
    </span>
  );
}
