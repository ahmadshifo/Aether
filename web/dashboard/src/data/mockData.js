// Member 2: dummy dashboard data shaped like shared/contracts/api-v1.yaml; replace with the services/ clients during integration.

export const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

// Frame records (Frame schema). Field names match GET /api/v1/frames exactly.
export const FRAMES = [
  {
    frame_id: 'a1e5c9f3-7d2b-4c8e-9a6f-3b0d5e1c7a94',
    captured_at: '2026-10-27T10:30:05Z',
    caption: 'A corridor door with a numbered sign',
    ocr_text: 'ROOM 205',
    objects: ['door', 'sign', 'hallway'],
  },
  {
    frame_id: '7b3f9d1e-6c2a-4e5b-8f0d-1a9c3e7b5d28',
    captured_at: '2026-10-27T10:30:14Z',
    caption: 'Chair in the hallway',
    ocr_text: '',
    objects: ['chair', 'hallway'],
  },
  {
    frame_id: '2c7d5e8a-1f3b-4a6c-9d0e-8b5f2a7c1e46',
    captured_at: '2026-10-27T10:30:28Z',
    caption: 'Green exit sign at the end of the hallway',
    ocr_text: 'EXIT',
    objects: ['sign', 'hallway'],
  },
  {
    frame_id: 'c4d8e2a6-9b1f-4d3c-8e7a-5f2b0c9d1e63',
    captured_at: '2026-10-27T10:30:39Z',
    caption: 'Water fountain beside a door',
    ocr_text: '',
    objects: ['fountain', 'door'],
  },
  {
    frame_id: 'e9a3b7c1-4f6d-4a2e-b8c0-7d1e5f3a9b26',
    captured_at: '2026-10-27T10:30:52Z',
    caption: 'Elevator doors with floor buttons',
    ocr_text: 'FLOOR 2',
    objects: ['elevator', 'button'],
  },
  {
    frame_id: '9e41b7c2-0a5d-4e8f-b3c6-d2a7f9e1c054',
    captured_at: '2026-10-27T10:31:04Z',
    caption: 'Notice board with a printed schedule',
    ocr_text: 'LAB HOURS 9:00 - 17:00',
    objects: ['board', 'paper'],
  },
  {
    frame_id: 'f3c8a1d4-5b6e-4f70-a9c2-7e8d1b0a4c93',
    captured_at: '2026-10-27T10:31:15Z',
    caption: 'Bench against the corridor wall',
    ocr_text: '',
    objects: ['bench', 'hallway'],
  },
  {
    frame_id: '6a2e9b0f-3c71-4d58-8e2a-91f4c7d3b602',
    captured_at: '2026-10-27T10:31:26Z',
    caption: 'Door with a numbered sign, slightly blurred',
    ocr_text: 'ROOM 207',
    objects: ['door', 'sign'],
  },
  {
    frame_id: '0d6f1c52-8a43-4c1e-9f7e-2b1d0a7c5e11',
    captured_at: '2026-10-27T10:31:37Z',
    caption: 'Empty hallway with ceiling lights',
    ocr_text: '',
    objects: ['hallway', 'light'],
  },
  {
    frame_id: '5f1d9c3b-8e2a-4b6f-9c0d-2e7a4b8f1c35',
    captured_at: '2026-10-27T10:31:46Z',
    caption: 'Stairway entrance with a handrail',
    ocr_text: 'STAIRS',
    objects: ['stairs', 'handrail', 'sign'],
  },
  {
    frame_id: '8c2e6a0d-3b7f-4e1a-a5c9-6d0b3f8e2a17',
    captured_at: '2026-10-27T10:31:53Z',
    caption: 'Building entrance with glass doors',
    ocr_text: 'ENGINEERING BLOCK',
    objects: ['door', 'glass', 'sign'],
  },
  {
    frame_id: 'b8b51e4a-32f2-4542-bbb1-cc9e6de18384',
    captured_at: '2026-10-27T10:31:58Z',
    caption: 'Green exit sign above a corridor door',
    ocr_text: 'EXIT',
    objects: ['sign', 'door', 'hallway'],
  },
].map((frame) => ({
  ...frame,
  session_id: SESSION_ID,
  image_url: `/api/v1/frames/${frame.frame_id}/image`,
}));

// UI-only: which illustration stands in for each frame until real JPEGs come from Member 3.
const SCENE_BY_OBJECT = [
  ['chair', 'chair'],
  ['bench', 'chair'],
  ['elevator', 'door'],
  ['door', 'door'],
  ['stairs', 'hallway'],
];
export function sceneFor(frame) {
  if (frame.ocr_text === 'EXIT') return 'exit';
  const match = SCENE_BY_OBJECT.find(([object]) => frame.objects.includes(object));
  return match ? match[1] : 'hallway';
}

// Question history (QuestionRecord). uncertain and evidence_frame_ids come from the AskResponse;
// QuestionRecord does not include them yet, so the dashboard needs a contract amendment to show them.
export const QUESTIONS = [
  {
    question_id: '2f3a2df0-3da3-446e-a59b-886f14d20dc5',
    asked_at: '2026-10-27T10:32:10Z',
    question: 'What was written on that door?',
    answer: 'The sign appears to say ROOM 205.',
    language: 'en',
    uncertain: false,
    evidence_frame_ids: ['a1e5c9f3-7d2b-4c8e-9a6f-3b0d5e1c7a94'],
  },
  {
    question_id: '4b9c1e7a-2d5f-4a8c-9e3b-6f0a1d7c4e82',
    asked_at: '2026-10-27T10:31:40Z',
    question: 'ماذا يوجد أمامي؟',
    answer: 'يبدو أن أمامك ممراً فارغاً مع أضواء في السقف.',
    language: 'ar',
    uncertain: false,
    evidence_frame_ids: ['0d6f1c52-8a43-4c1e-9f7e-2b1d0a7c5e11'],
  },
  {
    question_id: '7e2a5c9f-1b4d-4e6a-8c0f-3d9b2e5a7c14',
    asked_at: '2026-10-27T10:31:30Z',
    question: 'What number is on the next door?',
    answer: "I'm not sure. The sign was blurry; it might say ROOM 207.",
    language: 'en',
    uncertain: true,
    evidence_frame_ids: ['6a2e9b0f-3c71-4d58-8e2a-91f4c7d3b602'],
  },
  {
    question_id: '9d4f7b2e-6a1c-4d8f-b5e0-2c7a9f3d1b68',
    asked_at: '2026-10-27T10:31:08Z',
    question: 'What does the notice board say?',
    answer: 'It shows lab hours from 9:00 to 17:00.',
    language: 'en',
    uncertain: false,
    evidence_frame_ids: ['9e41b7c2-0a5d-4e8f-b3c6-d2a7f9e1c054'],
  },
  {
    question_id: '1c8e3a6d-5f2b-4c9e-a7d1-8b4f0e2c6a35',
    asked_at: '2026-10-27T10:30:20Z',
    question: 'Is there anything in my way?',
    answer: 'I can see a chair in the hallway ahead. I cannot tell you the path is clear.',
    language: 'en',
    uncertain: false,
    evidence_frame_ids: ['7b3f9d1e-6c2a-4e5b-8f0d-1a9c3e7b5d28', '2c7d5e8a-1f3b-4a6c-9d0e-8b5f2a7c1e46'],
  },
];

// GET /api/v1/status response (ServiceStatus enum: online | connecting | offline | error).
export const STATUS = { streaming: 'online', multimedia: 'online', ai: 'online' };

export const STREAM = {
  protocol: 'WebRTC (WHEP)',
  path: `live/${SESSION_ID}/whep`,
  resolution: '1280 × 720',
  fps: 15,
  codec: 'H.264',
  device: 'iPhone camera',
};
