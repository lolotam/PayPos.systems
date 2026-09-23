-- platform_roles — global identity (ADR-0003 §2.1, PRD P0-T9b.4): the platform staff role codes, readable by
-- pospay_auth (which resolves platform principals) and written only by the seed as pospay_owner. No tenant role can
-- reference it, and no runtime role can change it. The privilege suite fails on anything not listed here.
GRANT SELECT ON platform_roles TO pospay_auth;
