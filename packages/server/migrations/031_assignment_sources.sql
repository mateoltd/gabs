-- Preserve existing grants as direct assignments. Policy-derived rows share the
-- existing tenant keys, RLS and invalidation trigger, but can be removed safely.
ALTER TABLE suite.module_assignments ADD COLUMN direct boolean NOT NULL DEFAULT true;
