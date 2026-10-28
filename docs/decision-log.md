<!-- All members: tracks approved interface changes so an individual teammate never silently breaks compatibility. -->
# Architecture Decision Log

## v1.0 - 2026-10-27

- Three independent owners: Mobile (1), Web and AI (2), Multimedia (3).
- Communication uses documented REST JSON contracts and MediaMTX stream paths.
- Public language codes are `en` and `ar`.
- Provider keys remain server-side, models are pretrained, and no model training is required.
- Working integrations must preserve UUIDs, UTC time and the specified response fields.

## Future changes

Record the date, owner, affected services, reason, and approved new contract version here before changing shared interfaces.
