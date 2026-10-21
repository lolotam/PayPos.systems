-- spec 060 D-A6: Postgres refuses a subquery in a CHECK, so the "no duplicate code" rule lives in this function.
CREATE FUNCTION staff_columns_distinct(columns text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT cardinality(columns) = (SELECT count(DISTINCT c) FROM unnest(columns) AS c)
$$;
--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "staff_columns" text[];--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "staff_months_back" smallint;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_staff_columns" CHECK ("business_settings"."staff_columns" IS NULL OR ("business_settings"."staff_columns" <@ ARRAY['date', 'time', 'service', 'customer_name', 'list_price', 'discount', 'net', 'share', 'estimated_commission', 'tip', 'rating_average']::text[] AND array_position("business_settings"."staff_columns", NULL) IS NULL AND staff_columns_distinct("business_settings"."staff_columns")));--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_staff_months_back" CHECK ("business_settings"."staff_months_back" IS NULL OR "business_settings"."staff_months_back" BETWEEN 1 AND 24);