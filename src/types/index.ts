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
  type: 'new_issue' | 'issue_update' | 'new_billing' | 'new_meeting' | 'user_approved' | 'charge_issued' | 'payment_received' | 'dues_issued' | 'dues_updated' | 'dues_removed';
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

export interface Expense {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  category: ExpenseCategory;
  description: string;
  amount_usd: number;
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
  created_by: string | null;
  created_at: string;
  unit?: Unit;
}

export interface Payment {
  id: string;
  unit_id: string;
  building_id: string;
  amount_usd: number;
  method: PaymentMethod;
  paid_on: string;
  note: string | null;
  receipt_url: string | null;
  recorded_by: string | null;
  created_at: string;
  unit?: Unit;
}

export type DuesCadence = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type DuesMethod = 'by_shares' | 'equal' | 'custom';
export type DuesPlanType = 'b1' | 'b2';

export interface DuesPlan {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  cadence: DuesCadence;
  method: DuesMethod;
  pool_amount: number | null;
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

export type ServiceType = 'elevator' | 'generator' | 'landscape' | 'security' | 'cleaning' | 'water' | 'internet' | 'other';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

export interface ServiceContract {
  id: string;
  building_id: string | null;
  compound_id: string | null;
  service: ServiceType;
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
