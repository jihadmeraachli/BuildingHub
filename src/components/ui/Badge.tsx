import type { ReactNode } from 'react';

type Color = 'blue' | 'green' | 'yellow' | 'red' | 'slate' | 'orange' | 'indigo' | 'emerald' | 'rose';

interface BadgeProps {
  color?: Color;
  children: ReactNode;
}

const colorClasses: Record<Color, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  indigo: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100',
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  yellow: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  red: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
  rose: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
  slate: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
};

export function Badge({ color = 'slate', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClasses[color]}`}>
      {children}
    </span>
  );
}
