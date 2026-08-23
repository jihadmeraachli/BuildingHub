// ============================================================
// Custom report — the ledger explorer.
//
// One table of everything that moved money (expenses out, payments in) with a
// filter bar over it, because "what did we spend on water between March and
// June, and what came in" was previously two screens and a calculator.
//
// The totals ALWAYS describe what is on screen, never the unfiltered set — a
// total that ignores the filter is a total nobody can act on. Screen, CSV and
// PDF all read the same rows from lib/reportData, so they cannot disagree
// (docs/REPORTING_GUIDANCE.md).
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Search, X } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LedgerReportDoc, downloadPdf } from '@/lib/pdf';
import { filterLedger, ledgerTotals, groupLedger, emptyLedgerFilters, type LedgerRow, type LedgerFilters, type LedgerGrouping } from '@/lib/reportData';
import { fmtMoney } from '@/lib/money';

// one formatter, following the reader's language (src/lib/money.ts)
const money = (n: number) => fmtMoney(n);
/** CSV that Excel opens correctly: quotes doubled, BOM so Arabic and accents
 *  survive, CRLF line endings. Without the BOM, Excel mangles every name. */
function toCsv(rows: LedgerRow[], head: string[]): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')];
  for (const r of rows) {
    lines.push([
      cell(r.date), cell(r.kind), cell(r.category), cell(r.description), cell(r.unit),
      cell(r.party), cell(r.currency),
      cell(r.kind === 'expense' ? -r.amountUsd : r.amountUsd),
      cell(r.amountLbp ?? ''), cell(r.lbpRate ?? ''),
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/** More than one scope turns on a selector. Scopes are mutually exclusive by
 *  design: a resident's charge IS a share of a building expense, so showing
 *  both in one list would double-count every figure. */
export interface LedgerScope { key: string; label: string; rows: LedgerRow[] }

export function CustomReportCard({ rows, scopes, entityName, unitFilter }: {
  rows?: LedgerRow[];
  scopes?: LedgerScope[];
  entityName: string;
  /** Unit LABEL chosen elsewhere in the app (the sidebar's my-home picker).
   *  Seeds the filter and re-applies whenever it changes, so the report agrees
   *  with the dashboard instead of quietly showing a different unit. Still
   *  overridable here — this drives the filter, it does not lock it. */
  unitFilter?: string;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<LedgerFilters>({ ...emptyLedgerFilters, unit: unitFilter ?? '' });
  useEffect(() => {
    setF((prev) => (prev.unit === (unitFilter ?? '') ? prev : { ...prev, unit: unitFilter ?? '' }));
  }, [unitFilter]);
  const [groupBy, setGroupBy] = useState<LedgerGrouping>('none');
  const [scopeKey, setScopeKey] = useState(scopes?.[0]?.key ?? '');
  const [busy, setBusy] = useState('');

  const activeScope = scopes?.find((s) => s.key === scopeKey) ?? scopes?.[0] ?? null;
  const source = activeScope ? activeScope.rows : (rows ?? []);

  // Offered only when there is a choice to make: an owner with one unit does
  // not need a selector whose every option is the same answer.
  const unitOptions = useMemo(
    () => [...new Set(source.map((r) => r.unit).filter(Boolean))].sort(),
    [source],
  );

  // Same principle for the party filter: a tenant only ever HAS tenant rows
  // (RLS, 0097), so offering them an owner/tenant choice would be offering a
  // choice that isn't theirs to make. It appears only when both are present.
  const hasBothParties = useMemo(
    () => source.some((r) => r.party === 'owner') && source.some((r) => r.party === 'tenant'),
    [source],
  );

  // Likewise currency: a building that only ever transacts in dollars should
  // not carry a filter with one live option.
  const currencyOptions = useMemo(
    () => [...new Set(source.map((r) => r.currency))].sort(),
    [source],
  );

  const shown = useMemo(() => filterLedger(source, f), [source, f]);
  const totals = useMemo(() => ledgerTotals(shown), [shown]);
  const dirty = f.kind !== 'all' || !!f.from || !!f.to || !!f.search || !!f.unit || !!f.party || !!f.currency;

  /** "Mar 2026" from "2026-03" — built from a real date so Arabic gets Arabic
   *  month names rather than a number. */
  const monthLabel = (yyyymm: string) =>
    new Date(`${yyyymm}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  const groups = useMemo(
    () => (groupBy === 'none' ? [] : groupLedger(shown, groupBy, monthLabel)),
    [shown, groupBy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Spelled out on the PDF so a printed copy says what it is showing. */
  const filterSummary = [
    activeScope?.label ?? '',
    f.kind === 'all' ? t('reports.custom.bothKinds') : f.kind === 'expense' ? t('reports.custom.expensesOnly') : t('reports.custom.paymentsOnly'),
    f.from || f.to ? `${f.from || '…'} → ${f.to || '…'}` : t('reports.custom.allDates'),
    f.unit ? f.unit : '',
    f.party ? t(`finance.${f.party}`) : '',
    f.currency ? f.currency : '',
    f.search ? `"${f.search}"` : '',
  ].filter(Boolean).join(' · ');

  function exportCsv() {
    const csv = toCsv(shown, [
      t('reports.custom.date'), t('reports.custom.kind'), t('reports.custom.category'),
      t('reports.custom.description'), t('reports.custom.unit'),
      t('reports.custom.party'), t('reports.custom.currency'),
      t('reports.custom.amountUsd'), t('reports.custom.amountLbp'), t('reports.custom.rate'),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `abniyah-custom-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    setBusy('pdf');
    try {
      await downloadPdf(
        <LedgerReportDoc
          entityName={entityName}
          filterSummary={filterSummary}
          generatedOn={new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          rows={shown}
          totals={totals}
        />,
        `abniyah-custom-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <Card>
      <CardBody>
        <h3 className="font-semibold flex items-center gap-2">
          <Search size={16} className="text-primary" />
          {t('reports.custom.title')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{t('reports.custom.blurb')}</p>

        {/* ── filters ─────────────────────────────────────────────────── */}
        <div className="grid gap-3 mt-4 sm:grid-cols-2 lg:grid-cols-4">
          {scopes && scopes.length > 1 && (
            <SelectField label={t('reports.custom.show')} value={activeScope?.key ?? ''} onValueChange={setScopeKey}>
              {scopes.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectField>
          )}
          <SelectField
            label={t('reports.custom.kind')}
            value={f.kind}
            onValueChange={(v) => setF({ ...f, kind: v as LedgerFilters['kind'] })}
          >
            <SelectItem value="all">{t('reports.custom.bothKinds')}</SelectItem>
            <SelectItem value="expense">{t('reports.custom.expensesOnly')}</SelectItem>
            <SelectItem value="payment">{t('reports.custom.paymentsOnly')}</SelectItem>
          </SelectField>
          <Input
            label={t('reports.custom.from')}
            type="date"
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
          <Input
            label={t('reports.custom.to')}
            type="date"
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
          <Input
            label={t('reports.custom.search')}
            value={f.search}
            placeholder={t('reports.custom.searchHint')}
            onChange={(e) => setF({ ...f, search: e.target.value })}
          />
          {unitOptions.length > 1 && (
            <SelectField
              label={t('reports.custom.unit')}
              value={f.unit || '__all__'}
              onValueChange={(v) => setF({ ...f, unit: v === '__all__' ? '' : v })}
            >
              <SelectItem value="__all__">{t('reports.custom.allUnits')}</SelectItem>
              {unitOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectField>
          )}
          {hasBothParties && (
            <SelectField
              label={t('reports.custom.party')}
              value={f.party || '__all__'}
              onValueChange={(v) => setF({ ...f, party: v === '__all__' ? '' : v as LedgerFilters['party'] })}
            >
              <SelectItem value="__all__">{t('reports.custom.bothParties')}</SelectItem>
              <SelectItem value="owner">{t('finance.owner')}</SelectItem>
              <SelectItem value="tenant">{t('finance.tenant')}</SelectItem>
            </SelectField>
          )}
          {currencyOptions.length > 1 && (
            <SelectField
              label={t('reports.custom.currency')}
              value={f.currency || '__all__'}
              onValueChange={(v) => setF({ ...f, currency: v === '__all__' ? '' : v as LedgerFilters['currency'] })}
            >
              <SelectItem value="__all__">{t('reports.custom.anyCurrency')}</SelectItem>
              <SelectItem value="USD">{t('reports.custom.usdOnly')}</SelectItem>
              <SelectItem value="LBP">{t('reports.custom.lbpOnly')}</SelectItem>
              <SelectItem value="MIX">{t('reports.custom.mixedOnly')}</SelectItem>
            </SelectField>
          )}
          {/* The one that answers "how much water per month" without a
              calculator: roll the same filtered rows up by month or category. */}
          <SelectField
            label={t('reports.custom.groupBy')}
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as LedgerGrouping)}
          >
            <SelectItem value="none">{t('reports.custom.groupNone')}</SelectItem>
            <SelectItem value="month">{t('reports.custom.groupMonth')}</SelectItem>
            <SelectItem value="category">{t('reports.custom.groupCategory')}</SelectItem>
          </SelectField>
        </div>

        {dirty && (
          <button
            onClick={() => setF(emptyLedgerFilters)}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
          >
            <X size={12} /> {t('reports.custom.clear')}
          </button>
        )}

        {/* ── totals: always the FILTERED set ─────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('reports.custom.moneyIn')}</div>
            <div className="text-lg font-semibold tabular-nums">{money(totals.payments)}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('reports.custom.moneyOut')}</div>
            <div className="text-lg font-semibold tabular-nums">{money(totals.expenses)}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('reports.custom.net')}</div>
            <div className="text-lg font-semibold tabular-nums">{money(totals.net)}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}>
            <Download size={14} /> {t('reports.custom.exportCsv')}
          </Button>
          <Button onClick={exportPdf} disabled={!shown.length || busy === 'pdf'}>
            <Download size={14} /> {busy === 'pdf' ? t('reports.custom.preparing') : t('reports.custom.exportPdf')}
          </Button>
        </div>

        {/* ── the rollup, when grouping is on ─────────────────────────── */}
        {groupBy !== 'none' && groups.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pe-3 font-medium">
                    {groupBy === 'month' ? t('reports.custom.month') : t('reports.custom.category')}
                  </th>
                  <th className="py-2 pe-3 font-medium text-end">{t('reports.custom.moneyOut')}</th>
                  <th className="py-2 pe-3 font-medium text-end">{t('reports.custom.moneyIn')}</th>
                  <th className="py-2 font-medium text-end">{t('reports.custom.net')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} className="border-b border-border/50">
                    <td className="py-2 pe-3 font-medium">{g.label}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{money(g.expenses)}</td>
                    <td className="py-2 pe-3 text-end tabular-nums">{money(g.payments)}</td>
                    <td className="py-2 text-end tabular-nums">{money(g.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── the detail. Scrolls inside itself so the page never scrolls
               sideways on a phone. ───────────────────────────────────── */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pe-3 font-medium">{t('reports.custom.date')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.category')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.description')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.unit')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.party')}</th>
                <th className="py-2 font-medium text-end">{t('reports.custom.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    {source.length === 0 ? t('reports.custom.nothingYet') : t('reports.custom.noMatch')}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b border-border/50">
                    <td className="py-2 pe-3 whitespace-nowrap text-muted-foreground">{r.date}</td>
                    <td className="py-2 pe-3">
                      {/* out/in as orange/green: money leaving is not an error,
                          so orange rather than red, and the pair reads at a
                          glance down a mixed column. */}
                      <Badge variant={r.kind === 'payment' ? 'green' : 'orange'}>{r.category}</Badge>
                    </td>
                    <td className="py-2 pe-3">
                      {r.description}
                      {r.amountLbp && r.lbpRate ? (
                        <span className="block text-xs text-muted-foreground">
                          LL {Number(r.amountLbp).toLocaleString('en-US')} @ {Number(r.lbpRate).toLocaleString('en-US')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3 text-muted-foreground">{r.unit || '—'}</td>
                    <td className="py-2 pe-3 text-muted-foreground">{r.party ? t('finance.' + r.party) : '—'}</td>
                    <td className="py-2 text-end tabular-nums whitespace-nowrap">
                      {r.kind === 'expense' ? `-${money(r.amountUsd)}` : money(r.amountUsd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
