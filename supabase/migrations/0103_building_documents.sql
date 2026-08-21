-- ============================================================
-- 0103_building_documents.sql
-- Nizam el Bineye, and the provenance of a unit's حصص (2026-08-21).
--
-- WHY THIS IS NOT JUST FILE STORAGE. `units.share_weight` (0002, "traditional
-- حصص weight") is the DEFAULT allocation method: that one number decides how
-- every expense splits across every unit. It has always sat in the database
-- with no stated authority. When a resident asks "why is my share bigger than
-- 3B's?", the admin has nothing in the app to point at.
--
-- The نظام البناية is exactly the document that answers it — the notarized
-- bylaws that fix each lot's share. Storing it next to the numbers it governs
-- turns share_weight from an assertion into a citation.
--
-- REFERENCE COPY, NOT THE LEGAL ONE. The authoritative Nizam lives at the Land
-- Registry (الدوائر العقارية). This table holds the building's working copy so
-- residents can read it; the UI says so, and nothing here should be presented
-- as having legal force.
--
-- VERSIONED, because bylaws get amended by general assembly vote and the
-- superseded text still matters in a dispute. There is deliberately no
-- is_current flag to drift out of step — current is simply MAX(version).
--
-- ⚠️ KNOWN LIMIT, NOT INTRODUCED HERE. RLS below protects the ROW. It does not
-- protect the FILE: the `attachments` bucket grants read on any object to any
-- authenticated user (0025), or to the whole internet while the bucket is
-- public (0005). So a Nizam PDF is only as private as its URL, exactly like
-- every expense receipt already in the app. Fixing that means scoping
-- storage.objects by path prefix platform-wide, which is a bigger and riskier
-- change than this feature. Flagged so nobody reads the policies below and
-- concludes the document itself is scoped.
--
-- COMPOUND OR BLOCK, the same either/or every other targetable object uses:
-- one Nizam usually covers a whole compound, but a standalone block has its
-- own. Exactly one of building_id / compound_id is set.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS building_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id   UUID REFERENCES buildings(id)  ON DELETE CASCADE,
  compound_id   UUID REFERENCES compounds(id)  ON DELETE CASCADE,
  doc_type      TEXT NOT NULL DEFAULT 'nizam',
  version       INT  NOT NULL DEFAULT 1,
  title         TEXT,
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  -- when the assembly adopted this text, not when it was uploaded
  effective_date DATE,
  note          TEXT,
  uploaded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- exactly one scope, the compound-or-block rule used throughout
  CONSTRAINT building_documents_one_scope CHECK (
    (building_id IS NOT NULL AND compound_id IS NULL)
    OR (building_id IS NULL AND compound_id IS NOT NULL)
  ),
  CONSTRAINT building_documents_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE building_documents IS
  'Building governance documents, Nizam el Bineye first. A reference copy: the legal original is at the Land Registry. Versioned because bylaws are amended by assembly vote and the superseded text still matters in a dispute; current version = MAX(version) per scope + doc_type.';
COMMENT ON COLUMN building_documents.effective_date IS
  'The date the assembly adopted this text, which is not the date it was uploaded.';

-- doc_type is a small closed list so a typo cannot silently create a second
-- bucket that no screen reads. Add to it here when a new kind is needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'building_documents_doc_type_known'
  ) THEN
    ALTER TABLE building_documents ADD CONSTRAINT building_documents_doc_type_known
      CHECK (doc_type IN ('nizam', 'other'));
  END IF;
END $$;

-- One row per version per scope: re-uploading v2 should fail loudly, not
-- leave two v2 rows and an ambiguous "current".
CREATE UNIQUE INDEX IF NOT EXISTS building_documents_bld_ver_idx
  ON building_documents (building_id, doc_type, version) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS building_documents_cmp_ver_idx
  ON building_documents (compound_id, doc_type, version) WHERE compound_id IS NOT NULL;

-- ------------------------------------------------------------
-- Where a unit's share comes from.
--
-- The DOCUMENT link is deliberately not per-unit: one Nizam fixes every share
-- in the building, so making an admin attach it 40 times would be data entry
-- for its own sake. The unit carries only the pointer INTO that document —
-- an article or table reference — and the screen resolves the document from
-- the unit's building.
-- ------------------------------------------------------------
ALTER TABLE units ADD COLUMN IF NOT EXISTS share_source_ref TEXT;

COMMENT ON COLUMN units.share_source_ref IS
  'Where in the Nizam this unit''s share_weight is fixed, e.g. "art. 7" or "الجدول 2". Optional; the document itself is resolved from the unit''s building, not stored per unit.';

-- ------------------------------------------------------------
-- RLS. Reading the bylaws is a resident's right, so SELECT follows
-- user_sees_building/user_sees_compound (0096) rather than any admin
-- capability. Writing is building.manage, with the compound case expanded the
-- way dues_plans (0015) already does it.
-- ------------------------------------------------------------
ALTER TABLE building_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS building_documents_select ON building_documents;
CREATE POLICY building_documents_select ON building_documents FOR SELECT
USING (
  (building_id IS NOT NULL AND user_sees_building(building_id))
  OR (compound_id IS NOT NULL AND user_sees_compound(compound_id))
);

DROP POLICY IF EXISTS building_documents_write ON building_documents;
CREATE POLICY building_documents_write ON building_documents FOR ALL
USING (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = building_documents.compound_id
          AND user_can(b.id, 'building.manage')))
)
WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = building_documents.compound_id
          AND user_can(b.id, 'building.manage')))
);

COMMIT;

-- ============================================================
-- Post-run checks:
--   A resident with a membership but no grant can READ their building's Nizam
--   and cannot insert one:
--     SELECT count(*) FROM building_documents;            -- their row(s)
--     INSERT INTO building_documents (building_id, file_url) VALUES (...);
--                                                         -- 42501 denied
--
--   Both scopes cannot be set at once:
--     INSERT ... (building_id, compound_id, file_url) VALUES (b, c, 'x');
--                                                         -- 23514 one_scope
--
--   Re-uploading the same version is rejected rather than duplicated:
--     INSERT twice with version = 1 for one building      -- 23505 on the 2nd
-- ============================================================
