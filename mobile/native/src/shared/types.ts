export type Language = 'en' | 'ar' | 'fr';
export type Phase = 'idle' | 'starting' | 'greeting' | 'listening' | 'hearing' | 'processing' | 'speaking' | 'paused' | 'unavailable' | 'error';
export type Page = 'welcome' | 'home' | 'assistant' | 'history' | 'settings' | 'help' | 'connection';
export type Owner = Readonly<{ source: string; userId: string; epoch: number }>;
export type Photo = { path: string; bytes: number; capturedAt: string };
export type Entry = {
  id: string; sessionId: string; questionId: string; question: string; answer: string;
  language: Language; createdAt: string; provenance: 'server'; input: 'speech' | 'typed'; photo?: Photo;
  uncertain: boolean; evidenceFrameIds: string[];
};
