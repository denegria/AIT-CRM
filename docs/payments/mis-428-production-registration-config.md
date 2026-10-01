# MIS-428 production registration configuration load

This release rebuilds AIT CRM production after the approved `staging` → `master`
promotion at `6f58ea1`. No application behavior or database schema changes are
introduced by this document.

Production Vercel configuration must include:

- `AITUSA_REGISTRATION_SHARED_SECRET`: distinct production-only service secret,
  matching the AIT USA site's `AIT_CRM_REGISTRATION_SECRET`.
- `AITUSA_REGISTRATION_SITE_ORIGIN`: `https://www.aitusainstitute.com`.
- The existing `DEJAVOO_PROD_*` HPP settings.

`DEJAVOO_PRODUCTION_IO_ENABLED` remains unset during the registration wiring
smoke. The production public-registration endpoint must reject an unauthenticated
request with `registration_unauthorized`; a valid site quote must return the
server-owned catalog without creating a registration or payment. The Dejavoo
callback must reject invalid authorization without invoking reconciliation.

Live payment activation and the single controlled $0.01 staff Collections
payment are separately gated in MIS-428. Do not store secret values, card data,
or raw provider payloads in this release packet.
