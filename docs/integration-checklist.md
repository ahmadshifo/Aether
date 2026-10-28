<!-- All members: checklist for connecting independent systems and recording end-to-end acceptance tests. -->
# Integration Checklist

- [ ] Confirm mobile PWA is acceptable to the instructor, or agree on a native alternative.
- [ ] Agree on accessible HTTPS hostname, network, server ports and authentication.
- [ ] Phone publishes a real WebRTC stream; dashboard receives it.
- [ ] Multimedia processor reads the same stream over RTSP.
- [ ] Processor selects frames and makes the OCR/timeline metadata available.
- [ ] `POST /api/v1/search` returns relevant real frames by session and time.
- [ ] Web AI uses returned image bytes and answers without inventing evidence.
- [ ] Voice API transcribes a real recording, then speaks the returned answer.
- [ ] Question and image histories remain associated with the correct session UUID.
- [ ] English and Arabic are tested with the chosen pretrained services.
- [ ] Every service handles missing evidence, API timeouts and disconnections.
- [ ] 24-hour cleanup, user consent and no-face-recognition restrictions are tested.
- [ ] Collect latency, search-quality, answer-accuracy and user-feedback measurements.
