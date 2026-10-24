-- Keep updated_at current on every UPDATE, matching the MySQL
-- `ON UPDATE CURRENT_TIMESTAMP` behaviour this schema had before moving to
-- PostgreSQL. Like MySQL, the column is only bumped when the row actually
-- changes and the statement didn't set updated_at itself (Drizzle's
-- `$onUpdate` already sets it for ORM updates).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW IS DISTINCT FROM OLD AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
		NEW.updated_at := now();
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON "leads" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER site_content_set_updated_at BEFORE UPDATE ON "site_content" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
