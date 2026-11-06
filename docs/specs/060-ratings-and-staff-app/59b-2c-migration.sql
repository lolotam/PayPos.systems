-- مسودة غير مرقمة؛ لا تُضاف إلى journal قبل منح مسار الترحيل.
-- الاكتشاف يكتب حدثًا مستقلاً لكل شركة تحت withTenant ويترك كل حالة إرسال سابقة كما هي.
-- pospay:data-step rating-claims-discovery

-- فهرس الاستعادة يشمل المنشور والمتوقف؛ CONCURRENTLY يبقي كتابات الأوتبوكس متاحة.
CREATE INDEX CONCURRENTLY IF NOT EXISTS outbox_rating_claims_replay_idx
ON outbox USING btree (company_id, id)
WHERE event_type IN ('ServiceSessionRecorded','ServiceSessionLinesAdded','ServiceLineChanged','RatingClaimsDiscoveryRequested');
