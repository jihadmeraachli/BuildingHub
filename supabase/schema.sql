-- ============================================================
-- BuildingHub — Full Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- Buildings (managed by super_admin)
CREATE TABLE buildings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  city          TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'Lebanon',
  photo_url     TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  building_id       UUID REFERENCES buildings(id) ON DELETE SET NULL,
  full_name         TEXT NOT NULL,
  apartment_number  TEXT,
  phone             TEXT,
  role              TEXT NOT NULL DEFAULT 'resident'
                    CHECK (role IN ('super_admin', 'building_admin', 'resident')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'rejected', 'inactive')),
  notify_email      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp   BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Meetings
CREATE TABLE meetings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  meeting_date    DATE NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  attendees       TEXT[] NOT NULL DEFAULT '{}',
  attachment_urls TEXT[] NOT NULL DEFAULT '{}',
  created_by      UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Billing entries
CREATE TABLE billing_entries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id      UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  category         TEXT NOT NULL
                   CHECK (category IN ('water', 'electricity', 'common_expenses', 'projects', 'contracts')),
  description      TEXT NOT NULL,
  amount_usd       NUMERIC(10, 2) NOT NULL,
  due_date         DATE,
  status           TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (status IN ('paid', 'unpaid')),
  invoice_url      TEXT,
  apartment_number TEXT,
  created_by       UUID NOT NULL REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Issues / faults
CREATE TABLE issues (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id      UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  reported_by      UUID NOT NULL REFERENCES profiles(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  priority         TEXT NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low', 'medium', 'urgent')),
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'resolved')),
  photo_urls       TEXT[] NOT NULL DEFAULT '{}',
  resolution_notes TEXT,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In-app notifications
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
              CHECK (type IN ('new_issue', 'issue_update', 'new_billing', 'new_meeting', 'user_approved')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX ON meetings(building_id, meeting_date DESC);
CREATE INDEX ON billing_entries(building_id, status);
CREATE INDEX ON billing_entries(building_id, category);
CREATE INDEX ON issues(building_id, status);
CREATE INDEX ON issues(reported_by);
CREATE INDEX ON notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- TRIGGER: auto-create profile on sign-up
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, apartment_number, phone, building_id, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.raw_user_meta_data->>'apartment_number',
    NEW.raw_user_meta_data->>'phone',
    (NEW.raw_user_meta_data->>'building_id')::UUID,
    'resident',
    'pending'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE buildings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- Helper: get current user's building_id
CREATE OR REPLACE FUNCTION current_user_building()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT building_id FROM profiles WHERE id = auth.uid();
$$;

-- ---- BUILDINGS ----
-- super_admin can do everything; others can read active buildings (for registration)
CREATE POLICY "buildings_select_active" ON buildings
  FOR SELECT USING (is_active = TRUE OR current_user_role() = 'super_admin');

CREATE POLICY "buildings_all_super_admin" ON buildings
  FOR ALL USING (current_user_role() = 'super_admin');

-- ---- PROFILES ----
-- Users can read their own profile; admins can read all profiles in their building; super_admin reads all
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

-- Users can update their own profile (limited fields enforced by app)
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Admins can update profiles in their building; super_admin can update any
CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

-- ---- MEETINGS ----
CREATE POLICY "meetings_select" ON meetings
  FOR SELECT USING (
    current_user_role() = 'super_admin'
    OR building_id = current_user_building()
  );

CREATE POLICY "meetings_insert_admin" ON meetings
  FOR INSERT WITH CHECK (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

CREATE POLICY "meetings_update_admin" ON meetings
  FOR UPDATE USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

CREATE POLICY "meetings_delete_admin" ON meetings
  FOR DELETE USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

-- ---- BILLING ENTRIES ----
-- Residents see only entries for their apartment (or building-wide entries)
CREATE POLICY "billing_select_resident" ON billing_entries
  FOR SELECT USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
    OR (
      building_id = current_user_building()
      AND (
        apartment_number IS NULL
        OR apartment_number = (SELECT apartment_number FROM profiles WHERE id = auth.uid())
      )
    )
  );

CREATE POLICY "billing_insert_admin" ON billing_entries
  FOR INSERT WITH CHECK (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

CREATE POLICY "billing_update_admin" ON billing_entries
  FOR UPDATE USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
  );

-- ---- ISSUES ----
-- Residents see only their own issues; admins see all in building
CREATE POLICY "issues_select" ON issues
  FOR SELECT USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
    OR (building_id = current_user_building() AND reported_by = auth.uid())
  );

CREATE POLICY "issues_insert" ON issues
  FOR INSERT WITH CHECK (
    building_id = current_user_building()
    AND reported_by = auth.uid()
  );

CREATE POLICY "issues_update_admin" ON issues
  FOR UPDATE USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
    OR (building_id = current_user_building() AND reported_by = auth.uid())
  );

-- ---- NOTIFICATIONS ----
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKETS (run via Supabase Dashboard or API)
-- ============================================================
-- Create these buckets in Storage → New Bucket:
--   1. "invoices"      — private, max 10MB, allow pdf/images
--   2. "issue-photos"  — private, max 5MB, allow images
--   3. "buildings"     — public,  max 5MB, allow images
--
-- Storage RLS policies (add in Dashboard → Storage → Policies):
--   invoices:  authenticated users in same building can read;
--              building_admin/super_admin can upload
--   issue-photos: authenticated users in same building can read;
--                 any active resident can upload
