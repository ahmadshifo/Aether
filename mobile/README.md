<!-- Member 1's guide: mobile camera, streaming, accessible controls, and Azure Speech-backed voice service. -->
# Member 1 - Mobile Application

Own `native/` (the phone app), `voice-service/` and `streaming/`. Keep Azure credentials in `voice-service/.env`, never in the phone app. See `shared/contracts/api-v1.yaml` and `docs/architecture.md`.

Your first independent demo should stream the phone camera, transcribe a recorded question, and speak a predefined answer.
