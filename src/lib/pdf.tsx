import { Document, Page, Text, View, Image, StyleSheet, pdf as pdfRenderer } from '@react-pdf/renderer';
import { fmtDate as fmtAppDate } from '@/lib/dateFmt';
import type { Charge, Payment, Expense, Unit, Adjustment, Dues } from '@/types';
import { adjustmentEffect } from '@/lib/balance';

const C = {
  indigo: '#4f46e5',
  teal: '#0F4A3F',   // Abniyah brand teal (matches the logo mark and email header)
  slate9: '#0f172a',
  slate7: '#334155',
  slate5: '#64748b',
  slate2: '#e2e8f0',
  slate1: '#f8fafc',
  emerald: '#059669',
  rose: '#e11d48',
  amber: '#d97706',
  white: '#ffffff',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.slate9, padding: '36 40 40 40', backgroundColor: C.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 16, borderBottom: `1.5 solid ${C.indigo}` },
  brand: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.indigo, letterSpacing: 0.5 },
  brandSub: { fontSize: 8, color: C.slate5, marginTop: 2 },
  metaRight: { alignItems: 'flex-end' },
  metaLabel: { fontSize: 7.5, color: C.slate5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metaValue: { fontSize: 9, color: C.slate7 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.slate9, marginBottom: 4 },
  subtitle: { fontSize: 8.5, color: C.slate5, marginBottom: 20 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  kpiBox: { flex: 1, backgroundColor: C.slate1, borderRadius: 6, padding: '10 12' },
  kpiLabel: { fontSize: 7.5, color: C.slate5, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  kpiValue: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.slate7, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingBottom: 4, borderBottom: `1 solid ${C.slate2}` },
  tableHead: { flexDirection: 'row', backgroundColor: C.slate1, borderRadius: 4, padding: '5 8', marginBottom: 2 },
  tableHeadCell: { fontSize: 7.5, color: C.slate5, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottom: `0.5 solid ${C.slate2}` },
  tableCell: { fontSize: 8.5, color: C.slate7 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7.5, color: C.slate5 },
  balanceSummary: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 20 },
  balanceBox: { backgroundColor: C.slate1, borderRadius: 6, padding: '10 16', alignItems: 'flex-end', minWidth: 180 },
  balanceLabel: { fontSize: 8, color: C.slate5, marginBottom: 2 },
  balanceValue: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  balanceSub: { fontSize: 7.5, color: C.slate5, marginTop: 2 },
  empty: { padding: '12 0', fontSize: 8.5, color: C.slate5, fontStyle: 'italic' },
});

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) => {
  try { return fmtAppDate(d); }
  catch { return d; }
};

/** react-pdf's built-in Helvetica is WinAnsi-only: characters outside that
 *  set (→, −, …) silently render as a blank or a stray glyph instead of
 *  erroring. Same class of bug as the U+2212 minus fix — swap the arrow for
 *  words rather than risk it on any text that reaches a PDF verbatim. */
const pdfSafe = (str: string) => str.replace(/\s*→\s*/g, ' to ').replace(/−/g, '-');

// ─── Unit Statement ───────────────────────────────────────────────────────────

/** One owner/tenant/former-tenant bucket of a unit's ledger. */
export interface StatementBucket {
  key: string;
  /** e.g. "Owner", "Tenant · Jey", "Former tenant · Nadine" */
  title: string;
  /** the bucket's own balance (owner incl. opening + adjustments) */
  balance: number;
  /** owner bucket only — carried-in opening balance, shown as a line */
  openingBalance?: number;
  charges: Pick<Charge, 'id' | 'description' | 'category' | 'amount_usd' | 'charge_date'>[];
  payments: Pick<Payment, 'id' | 'note' | 'method' | 'amount_usd' | 'paid_on'>[];
  adjustments: Pick<Adjustment, 'id' | 'kind' | 'amount_usd' | 'effective_date' | 'note' | 'counterparty_name'>[];
  /** Dues that fall on THIS bucket's party (0070). Obligations, not ledger
   *  movements — they are listed for reference and never folded into the
   *  bucket's balance, which comes from charges/payments/adjustments alone. */
  dues?: Pick<Dues, 'id' | 'period_label' | 'due_date' | 'amount_due' | 'kind' | 'label'>[];
}

export interface UnitStatementProps {
  unitLabel: string;
  buildingName: string;
  period: string;
  generatedOn: string;
  /** owner / current-tenant / former-tenant buckets, in display order */
  buckets: StatementBucket[];
  /** the unit's combined balance across all buckets */
  combinedBalance: number;
}

const balCol = (n: number) => (n < 0 ? C.rose : n > 0 ? C.emerald : C.slate5);

// One bucket rendered as a titled block: header (name + balance) then the
// charges / payments / adjustments it contains.
function BucketBlock({ b }: { b: StatementBucket }) {
  const charged = b.charges.reduce((s, c) => s + Number(c.amount_usd), 0);
  const paid = b.payments.reduce((s, p) => s + Number(p.amount_usd), 0);
  return (
    <View style={s.section} wrap={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 4, borderBottom: `1 solid ${C.slate2}` }}>
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.slate9 }}>{b.title}</Text>
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: balCol(b.balance) }}>{money(b.balance)}</Text>
      </View>

      {/* summary + opening line */}
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
        <Text style={{ fontSize: 8, color: C.slate5 }}>Charged <Text style={{ color: C.slate7 }}>{money(charged)}</Text></Text>
        <Text style={{ fontSize: 8, color: C.slate5 }}>Paid <Text style={{ color: C.emerald }}>{money(paid)}</Text></Text>
        {!!b.openingBalance && (
          <Text style={{ fontSize: 8, color: C.slate5 }}>Opening balance <Text style={{ color: balCol(b.openingBalance) }}>{money(b.openingBalance)}</Text></Text>
        )}
      </View>

      {b.charges.length > 0 && (
        <>
          <View style={s.tableHead}>
            <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
            <Text style={[s.tableHeadCell, { flex: 3 }]}>Charge</Text>
            <Text style={[s.tableHeadCell, { flex: 1.3 }]}>Category</Text>
            <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
          </View>
          {b.charges.map((c) => (
            <View key={c.id} style={s.tableRow}>
              <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(c.charge_date)}</Text>
              <Text style={[s.tableCell, { flex: 3 }]}>{c.description}</Text>
              <Text style={[s.tableCell, { flex: 1.3, color: C.slate5 }]}>{c.category.replace('_', ' ')}</Text>
              <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.rose }]}>{money(-Number(c.amount_usd))}</Text>
            </View>
          ))}
        </>
      )}

      {b.payments.length > 0 && (
        <>
          <View style={[s.tableHead, { marginTop: b.charges.length > 0 ? 6 : 0 }]}>
            <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
            <Text style={[s.tableHeadCell, { flex: 3 }]}>Payment</Text>
            <Text style={[s.tableHeadCell, { flex: 1.3 }]}>Method</Text>
            <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
          </View>
          {b.payments.map((p) => (
            <View key={p.id} style={s.tableRow}>
              <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(p.paid_on)}</Text>
              <Text style={[s.tableCell, { flex: 3 }]}>{p.note ?? 'Payment'}</Text>
              <Text style={[s.tableCell, { flex: 1.3, color: C.slate5 }]}>{p.method.replace('_', ' ')}</Text>
              <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.emerald }]}>{money(Number(p.amount_usd))}</Text>
            </View>
          ))}
        </>
      )}

      {b.adjustments.length > 0 && (
        <>
          <View style={[s.tableHead, { marginTop: (b.charges.length > 0 || b.payments.length > 0) ? 6 : 0 }]}>
            <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
            <Text style={[s.tableHeadCell, { flex: 4.3 }]}>Adjustment</Text>
            <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Effect</Text>
          </View>
          {b.adjustments.map((a) => {
            const eff = adjustmentEffect(a.kind, Number(a.amount_usd));
            return (
              <View key={a.id} style={s.tableRow}>
                <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(a.effective_date)}</Text>
                <Text style={[s.tableCell, { flex: 4.3 }]}>{a.kind.replace('_', ' ')}{a.note ? ` · ${a.note}` : ''}{a.counterparty_name ? ` · ${a.counterparty_name}` : ''}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: balCol(eff) }]}>{money(eff)}</Text>
              </View>
            );
          })}
        </>
      )}

      {!!b.dues?.length && (
        <>
          <View style={[s.tableHead, { marginTop: (b.charges.length > 0 || b.payments.length > 0 || b.adjustments.length > 0) ? 6 : 0 }]}>
            <Text style={[s.tableHeadCell, { flex: 1 }]}>Due date</Text>
            <Text style={[s.tableHeadCell, { flex: 4.3 }]}>Dues</Text>
            <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount due</Text>
          </View>
          {b.dues.map((d) => (
            <View key={d.id} style={s.tableRow}>
              <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{d.due_date ? fmtDate(d.due_date) : '—'}</Text>
              <Text style={[s.tableCell, { flex: 4.3 }]}>
                {d.period_label}{d.kind === 'off_budget' ? ` · ${d.label ?? 'Off-budget'}` : ''}
              </Text>
              <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.slate7 }]}>{money(Number(d.amount_due))}</Text>
            </View>
          ))}
        </>
      )}

      {b.charges.length === 0 && b.payments.length === 0 && b.adjustments.length === 0 && !b.dues?.length && (
        <Text style={s.empty}>No transactions in this period.</Text>
      )}
    </View>
  );
}

export function UnitStatementDoc({ unitLabel, buildingName, period, generatedOn, buckets, combinedBalance }: UnitStatementProps) {
  const totalCharged = buckets.reduce((s, b) => s + b.charges.reduce((x, c) => x + Number(c.amount_usd), 0), 0);
  const totalPaid = buckets.reduce((s, b) => s + b.payments.reduce((x, p) => x + Number(p.amount_usd), 0), 0);

  return (
    <Document title={`Statement: ${unitLabel}`} author="Abniyah">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>ABNIYAH</Text>
            <Text style={s.brandSub}>{buildingName}</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaLabel}>Period</Text>
            <Text style={s.metaValue}>{period}</Text>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Generated</Text>
            <Text style={s.metaValue}>{generatedOn}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={s.title}>Unit Statement</Text>
        <Text style={s.subtitle}>Unit {unitLabel}</Text>

        {/* KPI row — combined across buckets */}
        <View style={s.kpiRow}>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Total Charged</Text>
            <Text style={[s.kpiValue, { color: C.slate9 }]}>{money(totalCharged)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Total Paid</Text>
            <Text style={[s.kpiValue, { color: C.emerald }]}>{money(totalPaid)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Balance</Text>
            <Text style={[s.kpiValue, { color: balCol(combinedBalance) }]}>{money(combinedBalance)}</Text>
          </View>
        </View>

        {/* Owner / Tenant / Former-tenant buckets */}
        {buckets.length === 0
          ? <View style={s.section}><Text style={s.empty}>No transactions to display.</Text></View>
          : buckets.map((b) => <BucketBlock key={b.key} b={b} />)}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Abniyah · {buildingName}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ─── Building / Compound Report ───────────────────────────────────────────────

export interface BuildingReportProps {
  entityName: string;
  period: string;
  generatedOn: string;
  kpi: { collected: number; billed: number; outstanding: number };
  book: { unit: Pick<Unit, 'id' | 'label'>; charged: number; paid: number; balance: number; owner?: number; tenant?: number; split?: boolean;
    hasActiveTenant?: boolean; activeTenantName?: string | null; curTenant?: number;
    showFormer?: boolean; fmrTenant?: number; fmrTenantNames?: string[] }[];
  expenses: Pick<Expense, 'id' | 'description' | 'category' | 'amount_usd' | 'expense_date'>[];
  payments?: { id: string; date: string; unit: string; method: string; amount: number }[];
  /** 0106: cash apart from receivables. Optional so old callers still render. */
  fund?: FundKpi;
}

/** The fund numbers a PDF prints (0106). Mirrors FundPositionResult without
 *  importing it, so pdf.tsx stays a leaf module. */
export interface FundKpi {
  opening: number; payments_in: number; other_in: number;
  expenses_out: number; other_out: number; refunds_out: number;
  cash: number; credits: number; arrears: number; available: number; reserve: number;
  fund_paid: number;
}

export function BuildingReportDoc({ entityName, period, generatedOn, kpi, book, expenses, payments = [], fund }: BuildingReportProps) {
  return (
    <Document title={`Financial Report: ${entityName}`} author="Abniyah">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>ABNIYAH</Text>
            <Text style={s.brandSub}>{entityName}</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaLabel}>Period</Text>
            <Text style={s.metaValue}>{period}</Text>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Generated</Text>
            <Text style={s.metaValue}>{generatedOn}</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={s.title}>Financial Report</Text>
        <Text style={s.subtitle}>{entityName} · {period}</Text>

        {/* KPIs */}
        <View style={s.kpiRow}>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Collected</Text>
            <Text style={[s.kpiValue, { color: C.emerald }]}>{money(kpi.collected)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Billed</Text>
            <Text style={[s.kpiValue, { color: C.slate9 }]}>{money(kpi.billed)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Outstanding</Text>
            <Text style={[s.kpiValue, { color: kpi.outstanding > 0 ? C.amber : C.slate5 }]}>{money(kpi.outstanding)}</Text>
          </View>
        </View>

        {/* 0106: the drawer, apart from the book. Cash is what is there;
            available is what the building may call its own today. */}
        {fund && (
          <View style={s.kpiRow}>
            <View style={s.kpiBox}>
              <Text style={s.kpiLabel}>Cash on hand</Text>
              <Text style={[s.kpiValue, { color: fund.cash < 0 ? C.rose : C.slate9 }]}>{money(fund.cash)}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiLabel}>Held for residents</Text>
              <Text style={[s.kpiValue, { color: C.slate5 }]}>{money(fund.credits)}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiLabel}>Available to spend</Text>
              <Text style={[s.kpiValue, { color: fund.available < 0 ? C.rose : C.emerald }]}>{money(fund.available)}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiLabel}>Reserve once collected</Text>
              <Text style={[s.kpiValue, { color: fund.reserve < 0 ? C.rose : C.slate9 }]}>{money(fund.reserve)}</Text>
            </View>
          </View>
        )}

        {/* Book — three sections: All units, then Owner-only, then Tenant-only.
            Tenant section lists only units that have/had a tenant (split). */}
        {book.length === 0 ? (
          <View style={s.section}><Text style={s.empty}>No units to display.</Text></View>
        ) : (
          <>
            {/* All units — total balances */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>All Units: Balances (All-Time)</Text>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 2 }]}>Unit</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Billed</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Paid</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Balance</Text>
              </View>
              {book.map((r) => (
                <View key={r.unit.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>{r.unit.label}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.slate5 }]}>{money(r.charged)}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.slate5 }]}>{money(r.paid)}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold', color: r.balance < 0 ? C.rose : r.balance > 0 ? C.emerald : C.slate5 }]}>{money(r.balance)}</Text>
                </View>
              ))}
            </View>

            {/* Owner-only balances */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Owner: Balances</Text>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 2 }]}>Unit</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Owner Balance</Text>
              </View>
              {book.map((r) => (
                <View key={r.unit.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>{r.unit.label}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: (r.owner ?? r.balance) < 0 ? C.rose : (r.owner ?? r.balance) > 0 ? C.emerald : C.slate5 }]}>{money(r.owner ?? r.balance)}</Text>
                </View>
              ))}
            </View>

            {/* Tenant balances — split into the CURRENT tenant and FORMER
                tenant(s) per unit, mirroring the Book. */}
            {book.some((r) => r.hasActiveTenant || r.showFormer) && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Tenant: Balances</Text>
                <View style={s.tableHead}>
                  <Text style={[s.tableHeadCell, { flex: 2 }]}>Unit</Text>
                  <Text style={[s.tableHeadCell, { flex: 2.2 }]}>Tenant</Text>
                  <Text style={[s.tableHeadCell, { flex: 1 }]}>Status</Text>
                  <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Balance</Text>
                </View>
                {book.flatMap((r) => {
                  const rows: { key: string; unit: string; name: string; status: string; bal: number }[] = [];
                  if (r.hasActiveTenant) rows.push({ key: `${r.unit.id}-cur`, unit: r.unit.label, name: r.activeTenantName ?? 'Tenant', status: 'Current', bal: r.curTenant ?? 0 });
                  if (r.showFormer) rows.push({ key: `${r.unit.id}-fmr`, unit: r.unit.label, name: (r.fmrTenantNames && r.fmrTenantNames.length) ? r.fmrTenantNames.join(', ') : 'Former tenant', status: 'Former', bal: r.fmrTenant ?? 0 });
                  return rows;
                }).map((row) => (
                  <View key={row.key} style={s.tableRow}>
                    <Text style={[s.tableCell, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>{row.unit}</Text>
                    <Text style={[s.tableCell, { flex: 2.2 }]}>{row.name}</Text>
                    <Text style={[s.tableCell, { flex: 1, color: row.status === 'Former' ? C.slate5 : C.slate7 }]}>{row.status}</Text>
                    <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: row.bal < 0 ? C.rose : row.bal > 0 ? C.emerald : C.slate5 }]}>{money(row.bal)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Payments received · period */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Payments Received · {period}</Text>
          {payments.length === 0 ? (
            <Text style={s.empty}>No payments in this period.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 3 }]}>Unit</Text>
                <Text style={[s.tableHeadCell, { flex: 1.5 }]}>Method</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              </View>
              {payments.map((p) => (
                <View key={p.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(p.date)}</Text>
                  <Text style={[s.tableCell, { flex: 3 }]}>{p.unit}</Text>
                  <Text style={[s.tableCell, { flex: 1.5, color: C.slate5 }]}>{p.method.replace('_', ' ')}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.emerald }]}>{money(p.amount)}</Text>
                </View>
              ))}
              <View style={[s.tableRow, { borderBottom: 'none' }]}>
                <Text style={[s.tableCell, { flex: 5.5, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>Total</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold', color: C.emerald }]}>{money(payments.reduce((sm, p) => sm + p.amount, 0))}</Text>
              </View>
            </>
          )}
        </View>

        {/* Expenses table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Expenses · {period}</Text>
          {expenses.length === 0 ? (
            <Text style={s.empty}>No expenses in this period.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 3 }]}>Description</Text>
                <Text style={[s.tableHeadCell, { flex: 1.5 }]}>Category</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              </View>
              {expenses.map((e) => (
                <View key={e.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(e.expense_date)}</Text>
                  <Text style={[s.tableCell, { flex: 3 }]}>{e.description}</Text>
                  <Text style={[s.tableCell, { flex: 1.5, color: C.slate5 }]}>{e.category.replace('_', ' ')}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right' }]}>{money(Number(e.amount_usd))}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Abniyah · {entityName}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ─── Custom report (the ledger) ───────────────────────────────────────────────

interface LedgerReportProps {
  entityName: string;
  /** the filter, spelled out — a report you cannot tell the shape of is a
   *  report you cannot hand to a committee */
  filterSummary: string;
  generatedOn: string;
  rows: {
    id: string; kind: 'expense' | 'payment'; date: string;
    category: string; description: string; unit: string; party: '' | 'owner' | 'tenant';
    amountUsd: number; amountLbp: number | null; lbpRate: number | null;
  }[];
  totals: { expenses: number; payments: number; net: number; count: number };
}

export function LedgerReportDoc({ entityName, filterSummary, generatedOn, rows, totals }: LedgerReportProps) {
  return (
    <Document title={`Custom Report: ${entityName}`} author="Abniyah">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>ABNIYAH</Text>
            <Text style={s.brandSub}>{entityName}</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaLabel}>Generated</Text>
            <Text style={s.metaValue}>{generatedOn}</Text>
          </View>
        </View>

        <Text style={s.title}>Custom Report</Text>
        <Text style={s.subtitle}>{filterSummary}</Text>

        <View style={s.balanceSummary}>
          <View style={s.balanceBox}>
            <Text style={s.balanceLabel}>Money in</Text>
            <Text style={[s.balanceValue, { color: C.slate9 }]}>{money(totals.payments)}</Text>
          </View>
          <View style={s.balanceBox}>
            <Text style={s.balanceLabel}>Money out</Text>
            <Text style={[s.balanceValue, { color: C.slate9 }]}>{money(totals.expenses)}</Text>
          </View>
          <View style={s.balanceBox}>
            <Text style={s.balanceLabel}>Net</Text>
            <Text style={[s.balanceValue, { color: C.slate9 }]}>{money(totals.net)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>{totals.count} entr{totals.count === 1 ? 'y' : 'ies'}</Text>
          {rows.length === 0 ? (
            <Text style={s.empty}>Nothing matches this filter.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Type</Text>
                <Text style={[s.tableHeadCell, { flex: 3 }]}>Description</Text>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Unit</Text>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Party</Text>
                <Text style={[s.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Amount</Text>
              </View>
              {rows.map((r) => (
                <View key={`${r.kind}-${r.id}`} style={s.tableRow} wrap={false}>
                  <Text style={[s.tableCell, { flex: 1 }]}>{fmtDate(r.date)}</Text>
                  <Text style={[s.tableCell, { flex: 1 }]}>{r.category}</Text>
                  <Text style={[s.tableCell, { flex: 3 }]}>
                    {r.description}
                    {/* the LBP part at its FROZEN rate — never re-converted */}
                    {r.amountLbp && r.lbpRate
                      ? `  (LL ${Number(r.amountLbp).toLocaleString('en-US')} @ ${Number(r.lbpRate).toLocaleString('en-US')})`
                      : ''}
                  </Text>
                  <Text style={[s.tableCell, { flex: 1 }]}>{r.unit || '—'}</Text>
                  <Text style={[s.tableCell, { flex: 1 }]}>{r.party ? r.party[0].toUpperCase() + r.party.slice(1) : '—'}</Text>
                  <Text style={[s.tableCell, { flex: 1.2, textAlign: 'right' }]}>
                    {/* money out is signed, so a mixed list reads correctly down the column */}
                    {r.kind === 'expense' ? `-${money(r.amountUsd)}` : money(r.amountUsd)}
                  </Text>
                </View>
              ))}
              <View style={[s.tableRow, { borderBottom: 'none' }]}>
                <Text style={[s.tableCell, { flex: 7, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>Net</Text>
                <Text style={[s.tableCell, { flex: 1.2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{money(totals.net)}</Text>
              </View>
            </>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Abniyah · {entityName}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ─── Download helper ──────────────────────────────────────────────────────────

// ─── Fund Statement (0106) ────────────────────────────────────────────────────
// Opening cash → in → out → closing, then the position, then the rows that are
// not on any unit's statement. The page that answers "where did the money go".

export interface FundStatementProps {
  entityName: string;
  period: string;
  generatedOn: string;
  billingMode: 'arrears' | 'dues';
  /** cash the day the period started (all-time: the fund's own opening) */
  openingOfPeriod: number;
  /** flows INSIDE the period; opening + these = position.cash */
  flows: Pick<FundKpi, 'payments_in' | 'other_in' | 'expenses_out' | 'other_out' | 'refunds_out'>;
  position: FundKpi;
  entries: { id: string; date: string; kind: 'income' | 'outflow'; description: string; counterparty: string | null; amount: number }[];
  fundPaidExpenses: { id: string; date: string; description: string; amount: number; fundPart: number }[];
}

export function FundStatementDoc({ entityName, period, generatedOn, billingMode, openingOfPeriod, flows, position, entries, fundPaidExpenses }: FundStatementProps) {
  const line = (label: string, value: number, opts: { bold?: boolean; color?: string; indent?: boolean } = {}) => (
    <View style={[s.tableRow, opts.bold ? { backgroundColor: C.slate1 } : {}]}>
      <Text style={[s.tableCell, { flex: 3, paddingLeft: opts.indent ? 12 : 0, fontFamily: opts.bold ? 'Helvetica-Bold' : 'Helvetica' }]}>{label}</Text>
      <Text style={[s.tableCell, { flex: 1, textAlign: 'right', fontFamily: opts.bold ? 'Helvetica-Bold' : 'Helvetica', color: opts.color ?? (value < 0 ? C.rose : C.slate9) }]}>{money(value)}</Text>
    </View>
  );
  const heldLabel = billingMode === 'dues' ? 'Prepaid by residents, not yet consumed' : 'Held for residents in credit';
  return (
    <Document title={`Fund Statement: ${entityName}`} author="Abniyah">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>ABNIYAH</Text>
            <Text style={s.brandSub}>{entityName}</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaLabel}>Period</Text>
            <Text style={s.metaValue}>{period}</Text>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Generated</Text>
            <Text style={s.metaValue}>{generatedOn}</Text>
          </View>
        </View>

        <Text style={s.title}>Fund Statement</Text>
        <Text style={s.subtitle}>{entityName} · {period}</Text>

        <View style={s.kpiRow}>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Cash on hand</Text>
            <Text style={[s.kpiValue, { color: position.cash < 0 ? C.rose : C.slate9 }]}>{money(position.cash)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Available to spend</Text>
            <Text style={[s.kpiValue, { color: position.available < 0 ? C.rose : C.emerald }]}>{money(position.available)}</Text>
          </View>
          <View style={s.kpiBox}>
            <Text style={s.kpiLabel}>Reserve once collected</Text>
            <Text style={[s.kpiValue, { color: position.reserve < 0 ? C.rose : C.slate9 }]}>{money(position.reserve)}</Text>
          </View>
        </View>

        {/* Cash movement INSIDE the period (the caller subtracts what preceded
            it), so opening + flows = closing on the page. */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Cash movement · {period}</Text>
          {line('Opening cash', openingOfPeriod, { bold: true })}
          {line('Payments from units', flows.payments_in, { indent: true, color: C.emerald })}
          {line('Other income', flows.other_in, { indent: true, color: C.emerald })}
          {line('Expenses', -flows.expenses_out, { indent: true })}
          {line('Other outflows', -flows.other_out, { indent: true })}
          {line('Refunds paid', -flows.refunds_out, { indent: true })}
          {line('Closing cash', position.cash, { bold: true })}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Position · end of period</Text>
          {line('Cash on hand', position.cash)}
          {line(heldLabel, -position.credits, { indent: true })}
          {line('Available to spend', position.available, { bold: true })}
          {line('Still to collect from residents', position.arrears, { indent: true })}
          {line('Reserve once collected', position.reserve, { bold: true })}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Other income and outflows · {period}</Text>
          {entries.length === 0 ? (
            <Text style={s.empty}>None in this period. Unit payments and expenses are on the building report.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 3 }]}>Description</Text>
                <Text style={[s.tableHeadCell, { flex: 2 }]}>Counterparty</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              </View>
              {entries.map((e) => (
                <View key={e.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{e.date}</Text>
                  <Text style={[s.tableCell, { flex: 3 }]}>{e.description}</Text>
                  <Text style={[s.tableCell, { flex: 2, color: C.slate5 }]}>{e.counterparty ?? '—'}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: e.kind === 'income' ? C.emerald : C.rose }]}>{e.kind === 'income' ? '+' : '-'}{money(e.amount)}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {fundPaidExpenses.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Expenses paid from the fund · {period}</Text>
            <View style={s.tableHead}>
              <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
              <Text style={[s.tableHeadCell, { flex: 3 }]}>Description</Text>
              <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Expense</Text>
              <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>From fund</Text>
            </View>
            {fundPaidExpenses.map((e) => (
              <View key={e.id} style={s.tableRow}>
                <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{e.date}</Text>
                <Text style={[s.tableCell, { flex: 3 }]}>{e.description}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.slate5 }]}>{money(e.amount)}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{money(e.fundPart)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.footer}>Cash on hand = opening cash + payments + other income - expenses - other outflows - refunds. Reserve = cash - what is held for residents + what is still to collect. Generated by Abniyah.</Text>
      </Page>
    </Document>
  );
}

// ─── Tax Invoice (subscription receipts, 0118) ────────────────────────────────
// Lebanese tax invoice for a PAID subscription invoice. Amounts are VAT-
// INCLUSIVE (Lebanese VAT 11%): net = total / 1.11, VAT = total − net,
// rounded to the cent so the three lines always sum exactly.

const SELLER = {
  name: 'Tatawwor L.L.C',
  address: 'Beirut, Lebanon',
  mof: 'MoF# 3880888',
  mobile: '+961 78 995 443',
};
const VAT_RATE = 0.11;

/** The pricing band a licence count falls in (0100 bands). */
function bandLabel(n: number | null | undefined): string {
  if (!n || n <= 0) return '—';
  if (n <= 20) return '1–20';
  if (n <= 40) return '21–40';
  if (n <= 70) return '41–70';
  if (n <= 120) return '71–120';
  if (n <= 200) return '121–200';
  if (n <= 350) return '201–350';
  if (n <= 500) return '351–500';
  return '500+ (negotiated)';
}

export interface TaxInvoiceProps {
  inv: {
    id: string;
    amount_cents: number;
    status: string;
    period_start: string;
    period_end: string;
    paid_at: string | null;
    created_at: string;
    kind?: 'period' | 'topup';
    description?: string | null;
    license_count?: number | null;
    payment_method?: string | null;
    payment_ref?: string | null;
  };
  entityName: string;
  scopeType: string;
  plan: 'monthly' | 'annual';
  billingEmail?: string | null;
}

export function TaxInvoiceDoc({ inv, entityName, scopeType, plan, billingEmail }: TaxInvoiceProps) {
  const total = inv.amount_cents / 100;
  const net = Math.round((inv.amount_cents / (1 + VAT_RATE))) / 100;
  const vat = Math.round(inv.amount_cents - inv.amount_cents / (1 + VAT_RATE)) / 100;
  const isTopup = inv.kind === 'topup';
  // "Top-up: 15 → 25 licences" (0117 description): parsed from the raw string
  // (which still has the arrow) before pdfSafe() rewrites it for display.
  const move = isTopup ? /(\d+)\s*→\s*(\d+)/.exec(inv.description ?? '') : null;
  const fromCount = move ? Number(move[1]) : null;
  const toCount = move ? Number(move[2]) : (inv.license_count ?? null);
  const addedCount = fromCount != null && toCount != null ? toCount - fromCount : null;
  const method = inv.payment_method === 'whish' ? 'Whish Money'
    : inv.payment_method === 'areeba' ? 'Card'
    : inv.payment_method ? inv.payment_method : '—';
  const invNo = `INV-${inv.id.slice(0, 8).toUpperCase()}`;

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', paddingVertical: 3 }}>
      <Text style={{ fontSize: 8.5, color: C.slate5, width: 130 }}>{label}</Text>
      <Text style={{ fontSize: 8.5, color: C.slate7, flex: 1 }}>{value}</Text>
    </View>
  );

  return (
    <Document title={`Tax Invoice ${invNo}`} author="Tatawwor L.L.C">
      <Page size="A4" style={s.page}>
        {/* Header: seller identity vs invoice identity — brand teal, not the
            indigo the other report PDFs use for their accent */}
        <View style={[s.header, { borderBottomColor: C.teal }]}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Image src="/logo-color.png" style={{ width: 34, height: 34 }} />
            <View>
              <Text style={[s.brand, { color: C.teal }]}>ABNIYAH</Text>
              <Text style={s.brandSub}>{SELLER.name}</Text>
              <Text style={s.brandSub}>{SELLER.address}</Text>
              <Text style={s.brandSub}>{SELLER.mof}</Text>
              <Text style={s.brandSub}>{SELLER.mobile}</Text>
            </View>
          </View>
          <View style={s.metaRight}>
            <Text style={[s.title, { color: C.teal }]}>TAX INVOICE</Text>
            <Text style={s.metaLabel}>Invoice No.</Text>
            <Text style={s.metaValue}>{invNo}</Text>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Issued</Text>
            <Text style={s.metaValue}>{fmtDate(inv.created_at)}</Text>
            {inv.paid_at ? (
              <>
                <Text style={[s.metaLabel, { marginTop: 6 }]}>Paid</Text>
                <Text style={[s.metaValue, { color: C.emerald }]}>{fmtDate(inv.paid_at)}</Text>
              </>
            ) : (
              <Text style={[s.metaValue, { marginTop: 6, color: C.amber }]}>{inv.status.toUpperCase()}</Text>
            )}
          </View>
        </View>

        {/* Bill to */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Billed To</Text>
          {row('Customer', entityName)}
          {row('Account type', scopeType === 'org' ? 'Organization' : scopeType === 'compound' ? 'Compound' : 'Building')}
          {billingEmail ? row('Billing email', billingEmail) : null}
        </View>

        {/* What was bought */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{isTopup ? 'License Top-up' : 'Subscription Period'}</Text>
          {row('Description', pdfSafe(inv.description ?? (isTopup ? 'License top-up' : 'Subscription')))}
          {row('Billing cycle', plan === 'annual' ? 'Annual (10 months for 12)' : 'Monthly')}
          {row(isTopup ? 'Covers until' : 'Period', isTopup
            ? fmtDate(inv.period_end)
            : `${fmtDate(inv.period_start)} to ${fmtDate(inv.period_end)}`)}
          {isTopup && fromCount != null && toCount != null ? (
            <>
              {row('Licenses', `${fromCount} to ${toCount}${addedCount ? ` (+${addedCount})` : ''}`)}
              {row('Band movement', `${bandLabel(fromCount)} units to ${bandLabel(toCount)} units`)}
              {row('Proration', 'Charged for the remaining days of the current period only')}
            </>
          ) : (
            <>
              {row('Licenses', String(toCount ?? '—'))}
              {row('Pricing band', `${bandLabel(toCount)} units`)}
            </>
          )}
        </View>

        {/* Payment */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Payment</Text>
          {row('Method', method)}
          {inv.payment_ref ? row('Reference', inv.payment_ref) : null}
          {inv.paid_at ? row('Settled on', fmtDate(inv.paid_at)) : null}
        </View>

        {/* Totals — VAT-inclusive breakdown */}
        <View style={s.balanceSummary}>
          <View style={[s.balanceBox, { minWidth: 230 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 3 }}>
              <Text style={s.balanceLabel}>Subtotal (excl. VAT)</Text>
              <Text style={[s.metaValue, { fontFamily: 'Helvetica-Bold' }]}>{money(net)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
              <Text style={s.balanceLabel}>VAT 11%</Text>
              <Text style={[s.metaValue, { fontFamily: 'Helvetica-Bold' }]}>{money(vat)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', borderTop: `1 solid ${C.slate2}`, paddingTop: 6 }}>
              <Text style={[s.balanceLabel, { fontSize: 9 }]}>Total (VAT inclusive)</Text>
              <Text style={[s.balanceValue, { fontSize: 14, color: C.slate9 }]}>{money(total)}</Text>
            </View>
          </View>
        </View>

        <Text style={{ fontSize: 7.5, color: C.slate5, marginTop: 4 }}>
          Prices are quoted VAT-inclusive; VAT is computed at the Lebanese standard rate of 11%.
          This document is a receipt for a payment already settled.
        </Text>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{SELLER.name} · {SELLER.mof} · {SELLER.address} · {SELLER.mobile}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadPdf(element: React.ReactElement, filename: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdfRenderer(element as any).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
