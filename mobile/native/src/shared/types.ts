export type Language = 'en' | 'ar';
export type Phase = 'idle' | 'starting' | 'listening' | 'hearing' | 'processing' | 'speaking' | 'paused' | 'unavailable' | 'error';
export type Page = 'welcome' | 'home' | 'assistant' | 'history' | 'settings' | 'help' | 'connection';
export type Owner = Readonly<{ source: string; userId: string; epoch: number }>;
export type Photo = { path: string; bytes: number; capturedAt: string };
export type Entry = {
  id: string; sessionId: string; questionId: string; question: string; answer: string;
  language: Language; createdAt: string; demo: true; input: 'speech' | 'typed'; photo?: Photo;
};
