import type { HistoryItem } from '../types';
export const HISTORY_KEY = 'echosight-native-history-v1';
export const LANGUAGE_KEY = 'echosight-native-language-v1';
export function parseHistory(raw: string | null): HistoryItem[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((item): item is HistoryItem => {
      if (!item || typeof item !== 'object') return false;
      const valid = typeof item.id === 'string' && typeof item.question === 'string'
        && typeof item.answer === 'string' && typeof item.time === 'string'
        && Number.isFinite(Date.parse(item.time)) && typeof item.demo === 'boolean'
        && (item.language === 'en' || item.language === 'ar') && !seen.has(item.id);
      if (valid) seen.add(item.id);
      return valid;
    }).slice(0, 50);
  } catch { return []; }
}
export function prependHistory(items: HistoryItem[], item: HistoryItem) {
  return [item, ...items.filter(previous => previous.id !== item.id)].slice(0, 50);
}
