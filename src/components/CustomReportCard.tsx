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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Search, X } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LedgerReportDoc, downloadPdf } from '@/lib/pdf';
import { filterLedger, ledgerTotals, emptyLedgerFilters, type LedgerRow, type LedgerFilters } from '@/lib/reportData';

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** CSV that Excel opens correctly: quotes doubled, BOM so Arabic and accents
 *  survive, CRLF line endings. Without the BOM, Excel mangles every name. */
function toCsv(rows: LedgerRow[], head: string[]): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')];
  for (const r of rows) {
    lines.push([
      cell(r.date), cell(r.kind), cell(r.category), cell(r.description), cell(r.unit),
      cell(r.kind === 'expense' ? -r.amountUsd : r.amountUsd),
      cell(r.amountLbp ?? ''), cell(r.lbpRate ?? ''),
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function CustomReportCard({ rows, entityName }: { rows: LedgerRow[]; entityName: string }) {
  const { t } = useTranslation();
  const [f, setF] = useState<LedgerFilters>(emptyLedgerFilters);
  const [busy, setBusy] = useState('');

  const shown = useMemo(() => filterLedger(rows, f), [rows, f]);
  const totals = useMemo(() => ledgerTotals(shown), [shown]);
  const dirty = f.kind !== 'all' || !!f.from || !!f.to || !!f.search;

  /** Spelled out on the PDF so a printed copy says what it is showing. */
  const filterSummary = [
    f.kind === 'all' ? t('reports.custom.bothKinds') : f.kind === 'expense' ? t('reports.custom.expensesOnly') : t('reports.custom.paymentsOnly'),
    f.from || f.to ? `${f.from || '…'} → ${f.to || '…'}` : t('reports.custom.allDates'),
    f.search ? `"${f.search}"` : '',
  ].filter(Boolean).join(' · ');

  function exportCsv() {
    const csv = toCsv(shown, [
      t('reports.custom.date'), t('reports.custom.kind'), t('reports.custom.category'),
      t('reports.custom.description'), t('reports.custom.unit'), t('reports.custom.amountUsd'),
      t('reports.custom.amountLbp'), t('reports.custom.rate'),
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

        {/* ── the table. Scrolls inside itself so the page never scrolls
               sideways on a phone. ───────────────────────────────────── */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pe-3 font-medium">{t('reports.custom.date')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.category')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.description')}</th>
                <th className="py-2 pe-3 font-medium">{t('reports.custom.unit')}</th>
                <th className="py-2 font-medium text-end">{t('reports.custom.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    {rows.length === 0 ? t('reports.custom.nothingYet') : t('reports.custom.noMatch')}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b border-border/50">
                    <td className="py-2 pe-3 whitespace-nowrap text-muted-foreground">{r.date}</td>
                    <td className="py-2 pe-3">
                      <Badge variant={r.kind === 'payment' ? 'green' : 'slate'}>{r.category}</Badge>
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
