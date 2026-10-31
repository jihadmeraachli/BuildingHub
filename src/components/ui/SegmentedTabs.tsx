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
    // Phones: a single row that scrolls sideways (snap per tab) — six Finance
    // tabs wrapped into two ragged rows otherwise. sm+: the inline pill track.
    <div className={`flex sm:inline-flex max-w-full overflow-x-auto sm:overflow-visible flex-nowrap sm:flex-wrap snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-1 bg-slate-100 dark:bg-white/5 rounded-xl ${className}`}>
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1.5 shrink-0 snap-start whitespace-nowrap text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${
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
