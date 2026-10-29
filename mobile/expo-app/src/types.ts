export type Language = 'en' | 'ar';
export type Phase = 'idle' | 'starting' | 'ready' | 'listening' | 'hearing' | 'processing' | 'speaking' | 'paused';
export type HistoryItem = {
  id: string; sessionId?: string; question: string; answer: string;
  language: Language; time: string; demo: boolean;
};
