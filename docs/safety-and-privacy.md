<!-- All members: constraints for a camera assistant serving visually impaired people and handling sensitive recordings. -->
# Safety and Privacy Rules

- This is a helper, not a replacement for a white cane or guide dog.
- Never claim that an environment is safe. State uncertainty explicitly.
- Never implement face identification or recognition; generic person detection is acceptable.
- Use the app only with consenting test participants.
- Explain that audio/images may be sent to external pretrained AI API providers.
- Do not retain raw microphone recordings after transcription.
- Delete stored frames, metadata and question history within 24 hours.
- Keep video, history and image endpoints access-controlled; use HTTPS for mobile camera access.
- Keep API provider keys server-side, never in frontend bundles or git commits.
