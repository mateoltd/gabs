-- A transaction snapshot predating cutover must not hide its completion after waiting for the storage lock.
-- Existing legacy commands use read committed; new SDK stores are not subject to this restriction.
CREATE OR REPLACE FUNCTION suite.guard_legacy_business_storage() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE workspace uuid; module_name text := TG_ARGV[0];
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'LEGACY_STORAGE_ISOLATION: legacy writes require read committed isolation' USING ERRCODE='55000';
 END IF;
 workspace := CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
 IF TG_OP='UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
  RAISE EXCEPTION 'Legacy business records cannot move between workspaces';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('module-storage:' || workspace::text, 0));
 IF EXISTS(SELECT 1 FROM suite.module_storage WHERE workspace_id=workspace AND module_id=module_name AND schema_version>=2) THEN
  RAISE EXCEPTION 'LEGACY_STORAGE_RETIRED: % now uses module stores in this workspace', module_name USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION suite.guard_legacy_order_counter() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.next_order_number IS DISTINCT FROM OLD.next_order_number THEN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
   RAISE EXCEPTION 'LEGACY_STORAGE_ISOLATION: legacy counter writes require read committed isolation' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('module-storage:' || NEW.id::text, 0));
  IF EXISTS(SELECT 1 FROM suite.module_storage WHERE workspace_id=NEW.id AND module_id='orders' AND schema_version>=2) THEN
   RAISE EXCEPTION 'LEGACY_STORAGE_RETIRED: Orders now uses a private counter' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
