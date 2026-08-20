export type UserRole = 'super_admin' | 'building_admin' | 'resident';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'inactive';
export type IssueStatus = 'open' | 'in_progress' | 'resolved';
export type IssuePriority = 'low' | 'medium' | 'urgent';
export type BillingCategory = 'water' | 'electricity' | 'common_expenses' | 'projects' | 'contracts';
export type BillingStatus = 'paid' | 'unpaid';

export interface Building {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  maps_url: string | null;
  compound_id: string | null;
  billing_mode: BillingMode;
  is_active: boolean;
  /** Legacy single-day reminder (1-28); superseded by the schedule below but
   *  kept in sync by set_reminder_schedule(). null = off. */
  reminder_day: number | null;
  /** Days residents get to pay after a payment request (0076). Compound wins. */
  payment_due_days?: number | null;
  /** Whish account (mobile number) residents can pay to; null = not offered. (0059) */
  whish_number: string | null;
  /** LBP-per-USD form prefill (0086). Each entry freezes the rate it used. */
  lbp_rate?: number | null;
  created_at: string;
}

export type BillingMode = 'arrears' | 'dues';

export interface Profile {
  id: string;
  building_id: string | null;
  full_name: string;
  apartment_number: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  notify_email: boolean;
  notify_whatsapp: boolean;
  /** UI + notification language; null = no explicit choice (device default). (0060) */
  preferred_language: 'en' | 'ar' | null;
  avatar_url: string | null;
  is_platform_admin?: boolean;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  building_id: string;
  title: string;
  meeting_date: string;
  meeting_time: string | null;
  meeting_type: 'scheduled' | 'past';
  summary: string;
  meeting_url: string | null;
  attendees: string[];
  attachment_urls: string[];
  created_by: string;
  created_at: string;
}

export interface BillingEntry {
  id: string;
  building_id: string;
  category: BillingCategory;
  description: string;
  amount_usd: number;
  due_date: string | null;
  status: BillingStatus;
  invoice_url: string | null;
  apartment_number: string | null;
  created_by: string;
  created_at: string;
}

export interface Issue {
  id: string;
  building_id: string;
  unit_id: string | null;
  reported_by: string;
  title: string;
  description: string;
  location: string;
  priority: IssuePriority;
  status: IssueStatus;
  apartment_number: string | null;
  photo_urls: string[];
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  reporter?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  building_id: string;
  type: 'new_issue' | 'issue_update' | 'new_billing' | 'new_meeting' | 'user_approved' | 'charge_issued' | 'payment_received' | 'dues_issued' | 'dues_updated' | 'dues_removed' | 'payment_requested';
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

// ============================================================
// v3 model (docs/WORKFLOW.md) — orgs, grants, units, finance
// ============================================================

export type Capability =
  | 'building.manage' | 'unit.manage' | 'group.manage'
  | 'resident.approve' | 'resident.manage' | 'grant.manage'
  | 'issue.view_all' | 'issue.update'
  | 'expense.manage' | 'charge.manage' | 'payment.record' | 'payment.confirm' | 'finance.view'
  | 'meeting.manage' | 'org.manage' | 'org.assign_buildings'
  // user lifecycle (migration 0026). 'user.delete' belongs to NO role —
  // platform admin only; it is never granted via role_has_cap().
  | 'user.deactivate' | 'user.delete';

// Ladder (migration 0027): platform(100) > org_admin(80) > compound_admin(70)
// > building_admin(60) > building_super(50) > *_finance(40) > viewer(20)
export type GrantRole =
  | 'org_admin' | 'org_finance'
  | 'compound_admin' | 'compound_finance'
  | 'building_admin' | 'building_finance' | 'building_super'
  | 'viewer';

export type GrantScope = 'org' | 'compound' | 'building';

export type Occupancy = 'occupied' | 'vacant' | 'abroad';
export type Tenure = 'owner' | 'tenant';
export type ExpenseCategory =
  | 'water' | 'electricity' | 'common_expenses' | 'projects' | 'contracts' | 'fines' | 'other';
export type AllocationScope = 'compound' | 'block' | 'group' | 'units' | 'unit';
export type BilledTo = 'owner' | 'tenant' | 'both';
export type AllocationMethod = 'equal' | 'by_shares' | 'custom' | 'percentage';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'other';

export interface Organization {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Compound {
  id: string;
  name: string;
  city: string | null;
  country: string;
  billing_mode: BillingMode;
  org_id: string | null;
  /** Days to pay (0076) — governs every block, like billing_mode. */
  payment_due_days?: number | null;
  /** LBP-per-USD form prefill (0086) — governs every block. */
  lbp_rate?: number | null;
  created_at: string;
}

export interface Grant {
  id: string;
  user_id: string;
  scope_type: GrantScope;
  org_id: string | null;
  /** Set when scope_type='compound' — covers every block in the compound (0027). */
  compound_id: string | null;
  building_id: string | null;
  role: GrantRole;
  created_at: string;
}

export interface Unit {
  id: string;
  building_id: string;
  label: string;
  share_weight: number;
  occupancy: Occupancy;
  /** Balance carried in when the unit joined. Signed: + = credit, − = owes. Excluded from P&L. (0033) */
  opening_balance: number;
  /** The date opening_balance is stated as-of. (0033) */
  opening_balance_date: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  unit_id: string;
  tenure: Tenure;
  /** Soft-end (move-out). NULL = active residency. Migration 0026. */
  ended_at: string | null;
  created_at: string;
  unit?: Unit;
}

export interface Group {
  id: string;
  building_id: string;
  name: string;
  created_at: string;
}

/** A building/compound's own expense catalog (0085). Seeded rows keep the
 *  legacy enum in `key`; custom rows have key NULL and file under 'other'. */
export interface ExpenseType {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  key: string | null;
  name: string;
  /** metered types (generator/water) get the metering module (0090) */
  is_metered: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Expense {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  category: ExpenseCategory;
  /** the catalog row this expense belongs to (0085); category is the legacy mirror */
  expense_type_id?: string | null;
  /** urgent one-off that auto-issued its ask (0089) */
  is_extraordinary?: boolean;
  /** posted by a metering cycle (0090) — the cycle is the source of truth */
  meter_cycle_id?: string | null;
  description: string;
  amount_usd: number;
  /** LBP part + frozen rate (0086); amount_usd is the canonical total. */
  amount_lbp?: number | null;
  lbp_rate?: number | null;
  expense_date: string;
  scope_type: AllocationScope;
  method: AllocationMethod;
  invoice_url: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Charge {
  id: string;
  expense_id: string | null;
  unit_id: string;
  building_id: string;
  category: string;
  description: string;
  amount_usd: number;
  charge_date: string;
  billed_to: BilledTo;
  /** the specific tenant this charge belongs to (when billed_to='tenant'). 0066 */
  tenant_id?: string | null;
  created_by: string | null;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  unit?: Unit;
}

export type AdjustmentKind = 'credit_note' | 'discount' | 'waiver' | 'write_off' | 'penalty' | 'refund'
  // system-generated on tenant move-out (T10) — a signed balance transfer
  | 'transfer_in' | 'transfer_out';

// Non-cash change to a unit's balance (0034). Sign of its balance effect is
// derived from `kind` — see adjustmentEffect() in src/lib/balance.ts.
export interface Adjustment {
  id: string;
  unit_id: string;
  building_id: string;
  kind: AdjustmentKind;
  amount_usd: number;      // positive magnitude
  /** Owner/tenant sub-ledger this adjustment belongs to (0064). */
  party: Tenure;
  /** the specific tenant (when party='tenant'). 0066 */
  tenant_id?: string | null;
  /** Other party's name for a move-out transfer, stored as text (T10 / 0065). */
  counterparty_name?: string | null;
  effective_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  unit?: Unit;
}

export interface Payment {
  id: string;
  unit_id: string;
  building_id: string;
  amount_usd: number;
  /** LBP part + frozen rate (0086); amount_usd is the canonical total. */
  amount_lbp?: number | null;
  lbp_rate?: number | null;
  method: PaymentMethod;
  paid_on: string;
  note: string | null;
  receipt_url: string | null;
  recorded_by: string | null;
  /** Owner/tenant sub-ledger this payment belongs to (0064). */
  paid_by: Tenure;
  /** the specific tenant who paid (when paid_by='tenant'). 0066 */
  tenant_id?: string | null;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  unit?: Unit;
}

export type DuesCadence = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type DuesMethod = 'by_shares' | 'equal' | 'custom';
export type DuesPlanType = 'b1' | 'b2';
/** What a dues row is: the plan's recurring pool, or a one-time assessment (0070). */
export type DuesKind = 'recurring' | 'off_budget';

export interface DuesPlan {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  cadence: DuesCadence;
  method: DuesMethod;
  /** Recurring budget. Billed to the TENANT on leased units, owner otherwise (0070). */
  pool_amount: number | null;
  /** Owner-only slice per period, same allocation method. 0 = none (0070). */
  owner_pool_amount: number | null;
  plan_type: DuesPlanType;
  active: boolean;
  created_at: string;
}

export interface Dues {
  id: string;
  plan_id: string | null;
  building_id: string;
  unit_id: string;
  period_label: string;
  due_date: string | null;
  base_amount: number;
  carry_in: number;
  amount_due: number;
  /** Which sub-ledger this obligation falls on (0070). Legacy rows = 'owner'.
   *  Tenure, not BilledTo — dues have no legacy 'both'. */
  billed_to: Tenure;
  /** The specific tenant billed; NULL on owner rows. Never rewritten on move-out
   *  — it records who was tenant when the due was issued (0070). */
  tenant_id: string | null;
  kind: DuesKind;
  /** the budget that issued this row (0087) */
  budget_id?: string | null;
  /** Name of an off_budget assessment, e.g. "Roof waterproofing 2026" (0070). */
  label: string | null;
  created_by: string | null;
  created_at: string;
}

export type InspectionCategory = 'generator' | 'elevator' | 'fire_safety' | 'water_tank' | 'electrical' | 'hvac' | 'other';
export type InspectionStatus = 'passed' | 'failed' | 'action_required' | 'pending';

export interface Inspection {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  category: InspectionCategory;
  title: string;
  inspector: string | null;
  inspection_date: string;
  status: InspectionStatus;
  outcome: string | null;
  next_due_date: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
}

export type ServiceType = 'elevator' | 'generator' | 'landscape' | 'security' | 'cleaning' | 'water' | 'internet' | 'maintenance' | 'other';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

export interface ServiceContract {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  service: ServiceType;
  service_other: string | null;
  provider_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  start_date: string | null;
  end_date: string | null;
  amount_usd: number | null;
  billing_cycle: BillingCycle | null;
  notes: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
}

// Building directory (migration 0073): free-text title + name + phone.
export interface BuildingContact {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  title: string;
  name: string;
  phone: string;
  created_by: string | null;
  created_at: string;
}

// ── Licensing (migration 0031) ───────────────────────────────

export type SubscriptionPlan = 'monthly' | 'annual';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'open' | 'paid' | 'void';

export interface Subscription {
  id: string;
  scope_type: GrantScope;
  building_id: string | null;
  compound_id: string | null;
  org_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  license_count: number;
  /** Platform-set cap override for legit outliers; null = license_cap(scope). (0071) */
  cap_override?: number | null;
  /** LEGACY (pre-0100): the per-unit rate this subscription was originally
   *  sold at. Kept as the record of what the customer agreed to. */
  price_per_unit_cents: number;
  /** The whole monthly price. NULL = use the band for the unit count (0100).
   *  Set only for a negotiated deal, which is everything above 500 units. */
  price_monthly_cents?: number | null;
  billing_email: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LicenseAssignment {
  id: string;
  subscription_id: string;
  unit_id: string;
  assigned_at: string;
  assigned_by: string | null;
  unassigned_at: string | null;
  unassigned_by: string | null;
}

export interface Invoice {
  id: string;
  subscription_id: string;
  amount_cents: number;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** An ad-hoc arrears collection (0076). Dues need no equivalent: a dues row
 *  already IS a request — amount, due date, party, tenant. */
export interface PaymentRequest {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  label: string | null;
  requested_on: string;
  due_date: string;
  created_by: string | null;
  created_at: string;
}

/** One party's share of a request. `amount_requested` is a SNAPSHOT of what
 *  they owed when it was issued — charges that land later belong to the next
 *  request, so paying this figure settles it however the balance has moved. */
export interface PaymentRequestLine {
  id: string;
  request_id: string;
  unit_id: string;
  building_id: string;
  party: Tenure;
  tenant_id: string | null;
  amount_requested: number;
  /** set when a move-out reassigned this line to the owner (0065 + 0076) */
  offloaded_from_tenant_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  request?: PaymentRequest;
}

/** A prepaid budget (0087) — every issuance is its own plan. Time-bound so
 *  Reports can hold it against the actual expenses in the window. */
export interface Budget {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  label: string;
  period_start: string;
  period_end: string;
  due_date: string | null;
  method: DuesMethod;
  billed_to: 'tenant_where_leased' | 'owner';
  true_up: boolean;
  /** set when auto-issued by an extraordinary expense (0089/0091) */
  expense_id?: string | null;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
}

/** One line of a budget: an expense type + an amount (USD/LBP, 0086). */
export interface BudgetLine {
  id: string;
  budget_id: string;
  expense_type_id: string | null;
  note: string | null;
  amount_usd: number;
  amount_lbp: number | null;
  lbp_rate: number | null;
  created_at: string;
}
