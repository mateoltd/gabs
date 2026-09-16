-- Retain legacy records for historical evidence, but prevent a second authority
-- after a workspace has moved its business modules to private stores.
CREATE FUNCTION suite.guard_legacy_business_storage() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE workspace uuid; module_name text := TG_ARGV[0];
BEGIN
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
REVOKE ALL ON FUNCTION suite.guard_legacy_business_storage() FROM PUBLIC;
CREATE TRIGGER products_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.products FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('inventory');
CREATE TRIGGER stock_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.stock FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('inventory');
CREATE TRIGGER stock_movements_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.stock_movements FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('inventory');
CREATE TRIGGER stock_counts_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.stock_counts FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('inventory');
CREATE TRIGGER orders_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.orders FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('orders');
CREATE TRIGGER order_lines_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.order_lines FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('orders');
CREATE TRIGGER customers_storage_fence BEFORE INSERT OR UPDATE OR DELETE ON suite.customers FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_business_storage('orders');
CREATE FUNCTION suite.guard_legacy_order_counter() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.next_order_number IS DISTINCT FROM OLD.next_order_number THEN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('module-storage:' || NEW.id::text, 0));
  IF EXISTS(SELECT 1 FROM suite.module_storage WHERE workspace_id=NEW.id AND module_id='orders' AND schema_version>=2) THEN
   RAISE EXCEPTION 'LEGACY_STORAGE_RETIRED: Orders now uses a private counter' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION suite.guard_legacy_order_counter() FROM PUBLIC;
CREATE TRIGGER order_counter_storage_fence BEFORE UPDATE OF next_order_number ON suite.workspaces FOR EACH ROW EXECUTE FUNCTION suite.guard_legacy_order_counter();
