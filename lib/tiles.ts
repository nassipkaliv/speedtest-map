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

export type TileProps = { q: string; d: number; u: number; l: number; t: number; v: number };

export const NETWORKS: Record<NetworkType, { label: string; short: string; about: string }> = {
  fixed: {
    label: 'Wi-Fi',
    short: 'Wi-Fi',
    about: 'телефон подключён к Wi-Fi — дома, в кафе, в офисе',
  },
  mobile: {
    label: 'Сотовая связь',
    short: 'Сотовая',
    about: 'телефон в сети оператора — 4G или 5G',
  },
};

/**
 * Расходящаяся шкала вокруг «нормально» (50–100 Мбит/с): медленные места
 * тёплые, быстрые — синие, середина серая и не спорит с краями. Одна шкала
 * для Wi-Fi и сотовой, чтобы 100 Мбит/с значили одно и то же.
 * Палитра проверена валидатором на фоне карты #0c0c0c: соседние ступени
 * различимы при протанопии/дейтеранопии (ΔE ≥ 9,6) и обычном зрении (≥ 17),
 * все точки контрастнее 3:1.
 */
export const TIERS = [
  { below: 25, label: 'Медленно', range: 'до 25', color: '#ec5f5f' },
  { below: 50, label: 'Так себе', range: '25–50', color: '#dca133' },
  { below: 100, label: 'Нормально', range: '50–100', color: '#5f5e59' },
  { below: 200, label: 'Быстро', range: '100–200', color: '#2f7fe0' },
  { below: Infinity, label: 'Очень быстро', range: '200+', color: '#a7cbf5' },
] as const;

export const tierOf = (mbps: number) => TIERS.find((t) => mbps < t.below) ?? TIERS[TIERS.length - 1];

/** Та же шкала выражением MapLibre. */
export const tierColorExpression = [
  'step',
  ['get', 'd'],
  TIERS[0].color,
  ...TIERS.slice(0, -1).flatMap((t, i) => [t.below, TIERS[i + 1].color]),
];

/** Меньше этого числа тестов значение — скорее анекдот, чем статистика. */
export const RELIABLE_TESTS = 3;

/* ── Геометрия тайлов ──────────────────────────────────────────────────── */

const ZOOM = 16;

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

function tileToQuadkey(x: number, y: number, z = ZOOM) {
  let key = '';
  for (let i = z; i > 0; i -= 1) {
    const mask = 1 << (i - 1);
    key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return key;
}

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function lngLatToTile(lon: number, lat: number, z = ZOOM) {
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * 2 ** z),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z),
  };
}

function tileCenter(qk: string): [number, number] {
  const { x, y, z } = quadkeyToTile(qk);
  return [tileLon(x + 0.5, z), tileLat(y + 0.5, z)];
}

/** Каждый квадрат — точка в его центре: сетка из точек читается легче, чем шахматка. */
export function tilesToPoints(rows: TileRow[]): FeatureCollection<Point, TileProps> {
  return {
    type: 'FeatureCollection',
    features: rows.map(([q, d, u, l, t, v], i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: tileCenter(q) },
      properties: { q, d, u, l, t, v },
    })),
  };
}

/* ── Отчёт по точке ────────────────────────────────────────────────────── */

export type PlaceReading = {
  download: number;
  upload: number;
  latency: number;
  tests: number;
  devices: number;
  /** 'tile' — свой квадрат; 'around' — свой пустой или ненадёжный, взяли соседей. */
  basis: 'tile' | 'around';
  /** Доля надёжных квадратов города, где загрузка ниже, 0…1. */
  fasterThan: number;
};

/** Индекс одного датасета: быстрый поиск квадрата и распределение для процентиля. */
export type TileIndex = { byKey: Map<string, TileRow>; reliableDownloads: number[] };

export function indexTiles(rows: TileRow[]): TileIndex {
  return {
    byKey: new Map(rows.map((r) => [r[0], r])),
    reliableDownloads: rows
      .filter((r) => r[4] >= RELIABLE_TESTS)
      .map((r) => r[1])
      .sort((a, b) => a - b),
  };
}

function weighted(rows: TileRow[]) {
  let devices = 0;
  let tests = 0;
  let d = 0;
  let u = 0;
  let l = 0;
  for (const [, down, up, lat, t, v] of rows) {
    devices += v;
    tests += t;
    d += down * v;
    u += up * v;
    l += lat * v;
  }
  return devices ? { download: d / devices, upload: u / devices, latency: l / devices, tests, devices } : null;
}

function share(sorted: number[], value: number) {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/**
 * Скорость в точке: свой квадрат, если в нём хватает тестов; иначе среднее
 * по квадрату и восьми соседям (≈ 1,8 × 1,2 км) с весом по устройствам.
 */
export function readingAt(index: TileIndex, lon: number, lat: number): PlaceReading | null {
  const { x, y } = lngLatToTile(lon, lat);
  const own = index.byKey.get(tileToQuadkey(x, y));

  let basis: PlaceReading['basis'] = 'tile';
  let value = own && own[4] >= RELIABLE_TESTS ? weighted([own]) : null;

  if (!value) {
    const around: TileRow[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const row = index.byKey.get(tileToQuadkey(x + dx, y + dy));
        if (row) around.push(row);
      }
    }
    value = weighted(around);
    basis = 'around';
  }
  if (!value) return null;

  return { ...value, basis, fasterThan: share(index.reliableDownloads, value.download) };
}

/* ── Районы ────────────────────────────────────────────────────────────── */

type Rings = number[][][];

function polygonsOf(geometry: Geometry): Rings[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function districtAt(districts: FeatureCollection | null, lon: number, lat: number): string | null {
  for (const feature of districts?.features ?? []) {
    const inside = polygonsOf(feature.geometry).some((rings) => {
      let hit = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
        }
      }
      return hit;
    });
    if (inside) return String(feature.properties?.name ?? '');
  }
  return null;
}

/** Точка для подписи района: центроид самого большого внешнего кольца. */
function labelPoint(geometry: Polygon | MultiPolygon): [number, number] {
  let best: [number, number] = [0, 0];
  let bestArea = 0;
  for (const [ring] of polygonsOf(geometry)) {
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
  for (const rings of polygonsOf(geometry)) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
    }
  }
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
