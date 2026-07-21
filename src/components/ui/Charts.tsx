// Hand-rolled, dependency-free SVG charts. Small and styleable.
import { useState } from 'react';

export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#0ea5e9', '#64748b'];

const DONUT_GRADIENTS = [
  { from: '#14b8a6', to: '#06b6d4' }, // teal → cyan
  { from: '#8b5cf6', to: '#6366f1' }, // violet → indigo
  { from: '#f59e0b', to: '#f97316' }, // amber → orange
  { from: '#ec4899', to: '#f43f5e' }, // pink → rose
  { from: '#10b981', to: '#14b8a6' }, // emerald → teal
  { from: '#3b82f6', to: '#818cf8' }, // blue → indigo-light
  { from: '#64748b', to: '#94a3b8' }, // slate
];

const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtMoney2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface TrendSeries { name: string; color: string; data: number[]; }

/** Multi-series line chart with a hover guide + tooltip showing each series' value. */
export function TrendChart({ labels, series, height = 180 }: { labels: string[]; series: TrendSeries[]; height?: number }) {
  const [idx, setIdx] = useState<number | null>(null);
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const PAD = 4; // inset so first/last points & labels are not flush to the edge
  const xPct = (i: number) => (n <= 1 ? 50 : PAD + (i / (n - 1)) * (100 - 2 * PAD));
  const yPct = (v: number) => (1 - v / max) * 100;
  const path = (data: number[]) => data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPct(i).toFixed(2)} ${yPct(v).toFixed(2)}`).join(' ');

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    setIdx(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  const tipTop = idx === null ? 0 : Math.min(...series.map((s) => yPct(s.data[idx])));
  const flipDown = tipTop < 32;
  // keep tooltip inside: anchor left near the start, right near the end, centered otherwise
  const tipX = idx === null ? 50 : xPct(idx);
  const tipAlignX = tipX < 18 ? '0%' : tipX > 82 ? '-100%' : '-50%';

  // label horizontal alignment: first sticks to left, last to right, rest centered under point
  const labelStyle = (i: number) =>
    i === 0
      ? { left: 0, transform: 'none', textAlign: 'left' as const }
      : i === n - 1
        ? { right: 0, left: 'auto' as const, transform: 'none', textAlign: 'right' as const }
        : { left: `${xPct(i)}%`, transform: 'translateX(-50%)' };

  return (
    <div>
      <div className="relative" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setIdx(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          {/* stroke via style (not the attribute) so hsl(var(--token)) colors resolve */}
          {series.map((s) => (
            <path key={s.name} d={path(s.data)} fill="none" style={{ stroke: s.color }} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {idx !== null && (
            <line x1={xPct(idx)} y1={0} x2={xPct(idx)} y2={100} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          )}
        </svg>

        {idx !== null && series.map((s) => (
          <span key={s.name} className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ring-2 ring-white"
            style={{ left: `${xPct(idx)}%`, top: `${yPct(s.data[idx])}%`, background: s.color }} />
        ))}

        {idx !== null && (
          <div className="absolute z-10 pointer-events-none"
            style={{ left: `${tipX}%`, top: `${tipTop}%`, transform: `translate(${tipAlignX}, ${flipDown ? '12px' : 'calc(-100% - 10px)'})` }}>
            <div className="bg-popover text-popover-foreground border border-border text-xs rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap">
              <p className="font-medium mb-0.5">{labels[idx]}</p>
              {series.map((s) => (
                <p key={s.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.name}: <span className="tnum font-semibold">{fmtMoney2(s.data[idx])}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative h-4 mt-1.5">
        {labels.map((l, i) => (
          <span key={i} className="absolute text-[10px] text-muted-foreground whitespace-nowrap" style={labelStyle(i)}>{l}</span>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

interface DonutDatum { label: string; value: number; color?: string; }

export function Donut({ data, size = 168, thickness = 22, centerLabel }: { data: DonutDatum[]; size?: number; thickness?: number; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            {DONUT_GRADIENTS.map((g, i) => (
              <linearGradient key={i} id={`donut-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={g.from} />
                <stop offset="100%" stopColor={g.to} />
              </linearGradient>
            ))}
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={thickness} />
          {total > 0 && data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke={`url(#donut-grad-${i % DONUT_GRADIENTS.length})`}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-foreground tnum">{fmtMoney(total)}</span>
          {centerLabel && <span className="text-[11px] text-muted-foreground">{centerLabel}</span>}
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {data.filter((d) => d.value > 0).map((d, i) => {
          const g = DONUT_GRADIENTS[i % DONUT_GRADIENTS.length];
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }} />
              <span className="text-muted-foreground truncate flex-1">{d.label}</span>
              <span className="text-foreground font-medium tnum">{fmtMoney(d.value)}</span>
            </div>
          );
        })}
        {total === 0 && <p className="text-sm text-muted-foreground">No data for this period.</p>}
      </div>
    </div>
  );
}

interface SeriesPoint { label: string; value: number; }

export function AreaChart({ data, height = 160, color = '#6366f1' }: { data: SeriesPoint[]; height?: number; color?: string }) {
  const width = 520;
  const pad = { t: 10, r: 8, b: 22, l: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = data.length;
  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${pad.t + innerH} L ${x(0).toFixed(1)} ${pad.t + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {n > 0 && <>
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={i}>
            {n <= 12 && <circle cx={x(i)} cy={y(d.value)} r={2.5} fill={color} />}
            <text x={x(i)} y={height - 6} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>{d.label}</text>
          </g>
        ))}
      </>}
    </svg>
  );
}

/** Thin progress bar used inside table cells (e.g. % collected per unit). */
export function MiniBar({ pct, color = '#10b981' }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}
