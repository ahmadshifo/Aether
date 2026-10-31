import type { LocalHistoryItem } from './historyRepository'

// Original vector illustrations, used only by explicit development preview/tests.
// No camera captures, external assets, patient instructions or safety claims.
export function historyFixtures(now = new Date()): LocalHistoryItem[] {
  const illustration = (label: string, color: string) => new Blob([
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#142b40"/><rect x="100" y="80" width="440" height="240" rx="28" fill="${color}"/><path d="M128 110h60m-60 0v60M512 290h-60m60 0v-60" stroke="#f1f5f9" fill="none" stroke-width="3"/><text x="320" y="210" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#f1f5f9">${label}</text><text x="320" y="370" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#b3c5d3">SAMPLE ILLUSTRATION</text></svg>`,
  ], { type: 'image/svg+xml' })
  const rows = [
    ['en', 'What is written on the door?', 'The sample sign reads “Room 205”.', 'ROOM 205', '#28536a'],
    ['en', 'What color is this notebook?', 'This illustrated notebook is teal.', 'NOTEBOOK', '#1c736c'],
    ['ar', 'ما المكتوب على الملصق؟', 'يظهر في هذا المثال النص «شاي بالنعناع».', 'MINT TEA', '#3d5b43'],
    ['en', 'Can you read the street sign?', 'The illustrated sign says Cedar Street. This example provides no information about traffic or crossing safety.', 'CEDAR ST.', '#395d72'],
    ['en', 'What is on this book cover?', 'An illustrated mountain and the title “Small Journeys”.', 'SMALL JOURNEYS', '#6c5366'],
    ['ar', 'ماذا يوجد على الطاولة؟', 'في هذا المثال التوضيحي، يوجد كوب بجانب كتاب. هذه إجابة تجريبية وليست تحليلًا لصورة الكاميرا.', 'CUP + BOOK', '#6c5644'],
    ['en', 'Can you describe the label?', 'This fictional medicine-label illustration only shows “Sample label”. It contains no dosage or medical advice.', 'SAMPLE LABEL', '#4c576f'],
    ['en', 'Please describe this object in detail.', 'The sample object is a small ceramic cup with a curved handle. '.repeat(24), 'CERAMIC CUP', '#536278'],
  ]
  return rows.map(([language, question, answer, label, color], index) => {
    const created = new Date(now)
    if (index > 3) { created.setDate(created.getDate() - 1); created.setHours(23, 59, 59, 999) }
    return { id: `sample-${index}`, language: language as 'en' | 'ar', question, answer, time: '', demo: true, sample: true,
      createdAt: index === 7 ? undefined : created.toISOString(), capturedAt: index === 7 ? undefined : created.toISOString(),
      photo: index === 7 ? undefined : illustration(label, color),
    }
  })
}
