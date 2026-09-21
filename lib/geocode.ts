/**
 * Адреса через Nominatim (OpenStreetMap). Photon быстрее и умеет подсказки,
 * но ищет только по казахским названиям улиц, а люди пишут по-русски.
 * Правила Nominatim запрещают автодополнение — поэтому ищем по Enter,
 * не чаще раза в секунду. Для продакшена нужен свой геокодер.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org';

/** Поиск ограничен городом с пригородами: [west, north, east, south] для viewbox. */
const VIEWBOX = '71.18,51.32,71.78,50.97';

export type Place = {
  lon: number;
  lat: number;
  title: string;
  subtitle: string | null;
};

type NominatimResult = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
};

function describe(r: NominatimResult): Place {
  const a = r.address ?? {};
  const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(', ');
  const area = a.suburb ?? a.city_district ?? a.neighbourhood ?? null;
  const named = r.name && r.name !== a.house_number ? r.name : null;

  return {
    lon: Number(r.lon),
    lat: Number(r.lat),
    title: named ?? (street || r.display_name.split(',').slice(0, 2).join(',').trim()),
    subtitle: named ? street || area : area,
  };
}

export async function searchAddress(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    'accept-language': 'ru',
    viewbox: VIEWBOX,
    bounded: '1',
  });
  const res = await fetch(`${ENDPOINT}/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return ((await res.json()) as NominatimResult[]).map(describe);
}

export async function reverseGeocode(lon: number, lat: number, signal?: AbortSignal): Promise<Place | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'ru',
  });
  const res = await fetch(`${ENDPOINT}/reverse?${params}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as NominatimResult & { error?: string };
  return data.error ? null : { ...describe(data), lon, lat };
}
