import { Document, Page, Text, View, StyleSheet, pdf as pdfRenderer } from '@react-pdf/renderer';
import type { Charge, Payment, Expense, Unit } from '@/types';

const C = {
  indigo: '#4f46e5',
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
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
};

// ─── Unit Statement ───────────────────────────────────────────────────────────

export interface UnitStatementProps {
  unitLabel: string;
  buildingName: string;
  period: string;
  generatedOn: string;
  charges: Pick<Charge, 'id' | 'description' | 'category' | 'amount_usd' | 'charge_date'>[];
  payments: Pick<Payment, 'id' | 'note' | 'method' | 'amount_usd' | 'paid_on'>[];
}

export function UnitStatementDoc({ unitLabel, buildingName, period, generatedOn, charges, payments }: UnitStatementProps) {
  const totalCharged = charges.reduce((s, c) => s + Number(c.amount_usd), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount_usd), 0);
  const balance = totalPaid - totalCharged;

  return (
    <Document title={`Statement — ${unitLabel}`} author="BuildingHub">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>BuildingHub</Text>
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

        {/* KPI row */}
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
            <Text style={[s.kpiValue, { color: balance < 0 ? C.rose : balance > 0 ? C.emerald : C.slate5 }]}>{money(balance)}</Text>
          </View>
        </View>

        {/* Charges table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Charges</Text>
          {charges.length === 0 ? (
            <Text style={s.empty}>No charges in this period.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 3 }]}>Description</Text>
                <Text style={[s.tableHeadCell, { flex: 1.5 }]}>Category</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              </View>
              {charges.map((c) => (
                <View key={c.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(c.charge_date)}</Text>
                  <Text style={[s.tableCell, { flex: 3 }]}>{c.description}</Text>
                  <Text style={[s.tableCell, { flex: 1.5, color: C.slate5 }]}>{c.category.replace('_', ' ')}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right' }]}>{money(Number(c.amount_usd))}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Payments table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Payments</Text>
          {payments.length === 0 ? (
            <Text style={s.empty}>No payments in this period.</Text>
          ) : (
            <>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, { flex: 1 }]}>Date</Text>
                <Text style={[s.tableHeadCell, { flex: 2 }]}>Note</Text>
                <Text style={[s.tableHeadCell, { flex: 1.5 }]}>Method</Text>
                <Text style={[s.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              </View>
              {payments.map((p) => (
                <View key={p.id} style={s.tableRow}>
                  <Text style={[s.tableCell, { flex: 1, color: C.slate5 }]}>{fmtDate(p.paid_on)}</Text>
                  <Text style={[s.tableCell, { flex: 2 }]}>{p.note ?? '—'}</Text>
                  <Text style={[s.tableCell, { flex: 1.5, color: C.slate5 }]}>{p.method.replace('_', ' ')}</Text>
                  <Text style={[s.tableCell, { flex: 1, textAlign: 'right', color: C.emerald }]}>{money(Number(p.amount_usd))}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>BuildingHub · {buildingName}</Text>
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
  book: { unit: Pick<Unit, 'id' | 'label'>; charged: number; paid: number; balance: number }[];
  expenses: Pick<Expense, 'id' | 'description' | 'category' | 'amount_usd' | 'expense_date'>[];
}

export function BuildingReportDoc({ entityName, period, generatedOn, kpi, book, expenses }: BuildingReportProps) {
  return (
    <Document title={`Financial Report — ${entityName}`} author="BuildingHub">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>BuildingHub</Text>
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

        {/* Book table */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Unit Balances (All-Time)</Text>
          {book.length === 0 ? (
            <Text style={s.empty}>No units to display.</Text>
          ) : (
            <>
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
          <Text style={s.footerText}>BuildingHub · {entityName}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ─── Download helper ──────────────────────────────────────────────────────────

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
