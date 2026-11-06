-- pospay:data-step rating-claims-discovery
-- الإعادة تزيل فهرسًا غير صالح تركه بناء متقطع؛ لا تلمس أحداث الاكتشاف الملتزم بها.
DROP INDEX CONCURRENTLY IF EXISTS "outbox_rating_claims_replay_idx";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "outbox_rating_claims_replay_idx" ON "outbox" USING btree ("company_id","id") WHERE "outbox"."event_type" IN ('ServiceSessionRecorded','ServiceSessionLinesAdded','ServiceLineChanged','RatingClaimsDiscoveryRequested');
