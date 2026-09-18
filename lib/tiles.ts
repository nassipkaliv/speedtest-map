import type { Feature, FeatureCollection, Geometry, MultiPolygon, Point, Polygon } from 'geojson';

/** [quadkey, загрузка Мбит/с, отдача Мбит/с, пинг мс, тестов, устройств] */
export type TileRow = [string, number, number, number, number, number];

export type NetworkType = 'fixed' | 'mobile';

export type Summary = {
  tiles: number;
  tests: number;
  devices: number;
  download: number;
  upload: number;
  latency: number;
};

export type Dataset = {
  id: string;
  type: NetworkType;
  year: number;
  quarter: number;
  file: string;
  city: Summary;
  districts: Record<string, Summary | null>;
};

export type DataIndex = {
  city: string;
  bbox: [number, number, number, number];
  generatedAt: string;
  datasets: Dataset[];
};

export type TileProps = { d: number; u: number; l: number; t: number; v: number };

/**
 * Одна шкала для домашнего и мобильного интернета — чтобы 100 Мбит/с
 * выглядели одинаково в обоих режимах. Один оттенок, от тёмного к светлому:
 * на тёмной карте быстрый интернет «светится», медленный — тусклый.
 * Палитра проверена валидатором как порядковая на фоне карты #0c0c0c.
 */
export const TIERS = [
  { below: 25, label: 'Медленно', range: 'до 25', color: '#184f95' },
  { below: 50, label: 'Терпимо', range: '25–50', color: '#2a78d6' },
  { below: 100, label: 'Нормально', range: '50–100', color: '#5598e7' },
  { below: 200, label: 'Быстро', range: '100–200', color: '#86b6ef' },
  { below: Infinity, label: 'Очень быстро', range: '200+', color: '#cde2fb' },
] as const;

export const tierOf = (mbps: number) => TIERS.find((t) => mbps < t.below) ?? TIERS[TIERS.length - 1];

/** Выражение MapLibre для той же шкалы. */
export const tierColorExpression = [
  'step',
  ['get', 'd'],
  TIERS[0].color,
  ...TIERS.slice(0, -1).flatMap((t, i) => [t.below, TIERS[i + 1].color]),
];

/** Меньше этого числа тестов значение тайла — скорее анекдот, чем статистика. */
export const RELIABLE_TESTS = 3;

/* ── Геометрия ─────────────────────────────────────────────────────────── */

function quadkeyToTile(qk: string) {
  let x = 0;
  let y = 0;
  for (const ch of qk) {
    const digit = Number(ch);
    x = x * 2 + (digit & 1);
    y = y * 2 + (digit >> 1);
  }
  return { x, y, z: qk.length };
}

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function quadkeyToPolygon(qk: string): Polygon {
  const { x, y, z } = quadkeyToTile(qk);
  const w = tileLon(x, z);
  const e = tileLon(x + 1, z);
  const n = tileLat(y, z);
  const s = tileLat(y + 1, z);
  return { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] };
}

export function tilesToGeoJSON(rows: TileRow[]): FeatureCollection<Polygon, TileProps> {
  return {
    type: 'FeatureCollection',
    features: rows.map(([qk, d, u, l, t, v], i) => ({
      type: 'Feature',
      id: i,
      geometry: quadkeyToPolygon(qk),
      properties: { d, u, l, t, v },
    })),
  };
}

/** Точка для подписи района: центроид самого большого внешнего кольца. */
function labelPoint(geometry: Polygon | MultiPolygon): [number, number] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best: [number, number] = [0, 0];
  let bestArea = 0;
  for (const [ring] of polygons) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = [cx / (3 * area), cy / (3 * area)];
    }
  }
  return best;
}

export function districtLabels(districts: FeatureCollection): FeatureCollection<Point, { name: string }> {
  return {
    type: 'FeatureCollection',
    features: districts.features.map(
      (f): Feature<Point, { name: string }> => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: labelPoint(f.geometry as Polygon | MultiPolygon) },
        properties: { name: String(f.properties?.name ?? '') },
      })
    ),
  };
}

export function boundsOf(geometry: Geometry): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === 'number') {
      const [x, y] = coords as number[];
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
      return;
    }
    (coords as unknown[]).forEach(visit);
  };
  if ('coordinates' in geometry) visit(geometry.coordinates);
  return [[w, s], [e, n]];
}

/* ── Формат ────────────────────────────────────────────────────────────── */

const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const mbps = (v: number) => (v < 10 ? one.format(v) : int.format(v));
export const count = (v: number) => int.format(v);

export const quarterLabel = (year: number, quarter: number) =>
  `${['I', 'II', 'III', 'IV'][quarter - 1]} кв. ${year}`;

/** «1 тест / 3 теста / 5 тестов» */
export function plural(n: number, [one_, few, many]: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one_;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Изменение к прошлому кварталу: «+4%», «−3%», «±0%». */
export function delta(now: number, before: number) {
  const pct = Math.round((now / before - 1) * 100);
  return { pct, text: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%` };
}
