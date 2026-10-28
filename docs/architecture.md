<!-- All members: records the approved system layout, roles and the independence-first development principle. -->
# Architecture v1.0

## Ownership

1. **Mobile:** React mobile UI, camera, MediaMTX server, Azure speech service.
2. **Web:** React dashboard, vision-language answer service, question history.
3. **Multimedia:** OpenCV frame pipeline, OCR, captioning, PostgreSQL metadata and search APIs.

## End-to-end flow

Phone -> MediaMTX -> multimedia processing -> database; recognized speech -> Web AI -> multimedia search -> visual answer -> Mobile TTS.

The dashboard watches MediaMTX and obtains frames/history from their respective APIs.

## Compatibility rules

- Use `shared/contracts/api-v1.yaml` as the source of truth for payloads and endpoint paths.
- Use `shared/contracts/media-v1.yaml` for stream names and access methods.
- Identify all interactions with a UUID `session_id`; date-times are UTC ISO 8601.
- Never access another member's internal storage or Python functions directly.
- Run each service independently with mock input before wiring services together.
