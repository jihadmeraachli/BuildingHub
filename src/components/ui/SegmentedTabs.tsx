import type { ElementType, ReactNode } from 'react';

export interface SegmentedTab<T extends string> {
  key: T;
  label: ReactNode;
  icon?: ElementType;
}

/**
 * The app-standard tab switcher — grey track with a raised pill on the active
 * tab (the Finance-page style: Book / Expenses / Payments / Adjustments).
 * Use this for every tab-like selector so they all highlight the same way.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-wrap p-1 bg-slate-100 dark:bg-white/5 rounded-xl ${className}`}>
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${
            value === key
              ? 'bg-white text-slate-900 shadow-sm dark:bg-primary/20 dark:text-primary dark:shadow-none'
              : 'text-slate-500 hover:text-slate-700 dark:text-white/70 dark:hover:text-primary'
          }`}
        >
          {Icon && <Icon size={15} />} {label}
        </button>
      ))}
    </div>
  );
}
