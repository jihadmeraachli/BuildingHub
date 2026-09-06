-- ============================================================
-- 0176_meter_readings_privacy.sql
-- RLS audit 2026-09-06: meter_readings_select (0090) only checked that the
-- CYCLE was visible - so any resident could pull every neighbor's individual
-- start/end readings (per-unit consumption) straight off the REST API. The
-- app never surfaces this (MeteringPanel gates on canManage), but the DB
-- allowed it - the exact client-trusts-narrower-contract gap the audit
-- hunts. Intended transparency (0090's comment) is the cycle AGGREGATE.
--
-- New scope: managers (finance.view) see all readings in their scope;
-- a resident sees common-area rows (unit_id NULL, aggregate transparency)
-- and their OWN unit's rows - never a neighbor's.
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS meter_readings_select ON meter_readings;
CREATE POLICY meter_readings_select ON meter_readings FOR SELECT USING (
  -- managers of the cycle's scope
  EXISTS (
    SELECT 1 FROM meter_cycles c
     WHERE c.id = meter_readings.cycle_id
       AND (is_platform_admin()
            OR (c.building_id IS NOT NULL AND user_can(c.building_id, 'finance.view'))
            OR (c.compound_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM buildings b
                   WHERE b.compound_id = c.compound_id
                     AND user_can(b.id, 'finance.view'))))
  )
  -- residents: common-area rows of a cycle in their building
  OR (meter_readings.unit_id IS NULL AND EXISTS (
        SELECT 1 FROM meter_cycles c
         WHERE c.id = meter_readings.cycle_id
           AND ((c.building_id IS NOT NULL AND user_member_building(c.building_id))
                OR (c.compound_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM buildings b
                       WHERE b.compound_id = c.compound_id
                         AND user_member_building(b.id))))))
  -- residents: their own unit's rows
  OR (meter_readings.unit_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.unit_id = meter_readings.unit_id
           AND m.user_id = auth.uid() AND m.ended_at IS NULL))
);

COMMIT;

-- Post-run checks:
--   As a resident: SELECT * FROM meter_readings (REST, unfiltered) returns
--   only their own unit's rows + common rows. As the admin: all rows.
--   MeteringPanel (manager view) unaffected - finance.view path covers it.
