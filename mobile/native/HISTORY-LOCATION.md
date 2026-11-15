# History area labels

Each camera question can carry the area where it was asked. The phone gets a fresh foreground location and reverse-geocodes it using the operating system. History stores only `{ label, captured_at }`, not coordinates, street addresses or continuous movement. An example label is `Beirut, Chiyah`; actual names and language depend on the phone's geocoder. City/district coverage is not guaranteed.

The location permission prompt appears when a session starts. Settings → Location → Save area in History disables future captures. Turning it off does not erase existing tags. Denied permission, disabled services, missing native support, inaccurate/stale fixes, failed geocoding, or the six-second deadline omit the tag without preventing an answer. No background location permission or tracking is used.

Location is captured with the final question, before answering. A later question gets a fresh fix. Existing tags never change when the phone moves. History cards, details, search, text copy and text share include the saved area. Photo-only sharing shares the photo as before. Older entries stay untagged; no location is guessed for them.

## Shared backend deployment

Deploy the backend changes before the new app; older servers reject the new optional request field. Existing clients remain compatible with the updated server.

- `POST /api/v1/ask`: optional `location: { "label": "Beirut, Chiyah", "captured_at": "2026-11-15T12:00:00Z" }`.
- Ask responses and `GET /api/v1/questions` return the stored location or `null`.
- The label is a non-empty, single-line string of at most 160 characters. Capture time must have a timezone. Extra fields, including coordinates, are rejected.
- Retrying a saved `question_id` returns its original saved location.
- MySQL `questions` adds nullable `location_label VARCHAR(160)` and `location_captured_at DATETIME(3)`. Times are stored as UTC.
- Startup checks for missing columns and adds only those missing. Existing rows and the current 24-hour History policy are preserved. A reinstall restores tags from the account API while the records remain within retention.

If the application database account has no ALTER privilege, a database administrator must apply the migration once. From `web/ai-backend`, with administrator `MYSQL_*` credentials set privately in the environment:

```powershell
python -c "from app.history import init_history_table; init_history_table()"
```

Then run the backend with its normal restricted account. Do not add admin credentials to Git or the mobile bundle. The laptop's existing MySQL database was migrated this way; all 20 pre-existing question rows were verified unchanged.

## Native build and validation

Run `npm ci` in `mobile/native`. `expo-location` is native, so rebuild the iPhone IPA or Android development client. An older binary still opens but cannot capture location. No new API key is required. Device STT/TTS and unfinished API voice work are unchanged.

Automated validation covers EN/AR/FR labels and UI, fresh capture after movement, permission denial, cancellation, settings changes, deadlines, cache restoration, API retry behavior, Unicode SQL persistence, account isolation and account History deletion. The MySQL integration test uses temporary accounts and a synthetic answer; it does not claim a physical GPS or AI model test.

Backend unit suite: `python -m unittest discover -s tests` from `web/ai-backend`.
Opt-in MySQL test: set `AETHER_MYSQL_INTEGRATION=1` and the regular `MYSQL_*` environment, then run `python -m unittest discover -s tests -p test_history_location_mysql.py`. It removes only its temporary accounts and their test records. The additive schema migration remains.

Phone acceptance before merging:

1. Install the new development build and connect to the updated backend and Metro.
2. Start a session, grant location while using the app, and ask a camera question.
3. Open History and check the saved area; Refresh and reopen the app to confirm it remains.
4. Move to another area, ask another question, and confirm only the new entry has the new area. Do not expect a specific spelling or district boundary.
5. Turn Save area in History off and ask again: the new entry has no tag and earlier tags remain.
6. Deny location or turn off Location Services: questions still work. Check Arabic and French History display, copy and search.

Physical-device location and movement checks remain pending. Main must not be merged until reviewed with the user.
