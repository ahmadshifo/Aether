import type { HistoryLocation } from '../shared/types.ts';
// Control characters are deliberately rejected from stored and shared single-line labels.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f]/g;

/** Only an area label and timestamp are stored. Coordinates and street addresses are not retained. */
export function parseHistoryLocation(value: unknown): HistoryLocation | undefined {
  if (!value || typeof value !== 'object') return;
  const place = value as Partial<HistoryLocation>;
  if (typeof place.label !== 'string' || !place.label.trim() || place.label.length > 160
    || place.label.replace(controls, '') !== place.label || typeof place.captured_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(place.captured_at)
    || !Number.isFinite(Date.parse(place.captured_at))) return;
  return { label: place.label.trim(), captured_at: new Date(place.captured_at).toISOString() };
}

export function areaLabel(address: { city?: string | null; district?: string | null; subregion?: string | null; region?: string | null; country?: string | null }) {
  const clean = (value: string | null | undefined) => typeof value === 'string' ? value.replace(controls, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  const city = clean(address.city) || clean(address.region) || clean(address.subregion) || clean(address.country);
  const district = clean(address.district) || clean(address.subregion);
  return [city, district].filter((value, index, values) => value && values.findIndex(other => other.toLocaleLowerCase() === value.toLocaleLowerCase()) === index).join(', ').slice(0, 160);
}
