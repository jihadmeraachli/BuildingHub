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
  is_active: boolean;
  created_at: string;
}

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
  type: 'new_issue' | 'issue_update' | 'new_billing' | 'new_meeting' | 'user_approved';
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}
