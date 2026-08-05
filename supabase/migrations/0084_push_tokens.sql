-- ============================================================
-- 0084_push_tokens.sql
-- Foundation for real phone notifications — the kind that arrive when the app
-- is closed and the phone is locked (#new). This migration is transport
-- agnostic: it stores WHERE to reach a person, not how the message is sent.
--
-- `device_tokens` is per DEVICE, not per user: one person may have an iPhone
-- and an iPad, and both should buzz. A token is owned by whoever registered
-- it, so signing out on a shared device must delete the row (the client does
-- this) — otherwise the next person's phone would receive the previous
-- person's building notices.
--
-- `platform` is stored from day one so an Android build later adds rows rather
-- than needing a schema change.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android', 'web')),
  -- Bumped every launch. A token that has not been seen for months is stale;
  -- APNs also reports dead tokens, and both are reasons to prune.
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The same physical device re-registering must UPDATE, not accumulate rows,
  -- or one phone ends up buzzing several times per notification.
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens(user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- A person manages only their own devices. The sender runs as the service role
-- inside the edge function, which bypasses RLS, so no read policy is needed
-- for delivery.
DROP POLICY IF EXISTS device_tokens_own ON device_tokens;
CREATE POLICY device_tokens_own ON device_tokens FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Third notification channel, beside notify_email / notify_whatsapp. Default
-- TRUE: registering a device is itself the opt-in, since iOS already asks for
-- permission before any token exists.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_push BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;

-- Post-run checks:
--   1. As a signed-in user: INSERT a row with your own user_id -> ok;
--      with someone else's -> denied.
--   2. Insert the same token twice -> second one violates the unique
--      constraint (the client upserts on `token`).
--   3. SELECT notify_push FROM profiles LIMIT 1 -> true.
