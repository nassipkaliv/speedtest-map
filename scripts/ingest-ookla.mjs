/**
 * Вырезает Астану из Ookla Open Data — глобальных квартальных тайлов
 * Speedtest (fixed и mobile), zoom 16, ~610 × 385 м на широте Астаны.
 *
 * Источник: s3://ookla-open-data (публичный, без ключа), лицензия CC BY-NC-SA 4.0.
 * https://github.com/teamookla/ookla-open-data
 *
 * Файл на квартал весит 180–350 МБ, но отсортирован по quadkey, поэтому
 * по статистике row group'ов читаем только тот кусок, где лежит Астана,
 * и только нужные колонки — без WKT-геометрии.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = join(process.env.TMPDIR ?? '/tmp', 'ookla-astana-cache');

/** Границы города с запасом на пригороды: [west, south, east, north]. */
const BBOX = [71.18, 50.97, 71.78, 51.32];
const ZOOM = 16;

const TYPES = ['fixed', 'mobile'];

/** Последние N кварталов, начиная с самого свежего опубликованного. */
const QUARTERS = process.argv[2] ? Number(process.argv[2]) : 4;

const BASE = 'https://ookla-open-data.s3.amazonaws.com';
const COLUMNS = ['quadkey', 'tile_x', 'tile_y', 'avg_d_kbps', 'avg_u_kbps', 'avg_lat_ms', 'tests', 'devices'];

/* ── Геометрия тайлов ──────────────────────────────────────────────────── */

const lonToX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** ZOOM);
const latToY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM);
};

function quadkey(x, y) {
  let key = '';
  for (let z = ZOOM; z > 0; z -= 1) {
    const mask = 1 << (z - 1);
    key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return key;
}

/** Диапазон quadkey'ев, покрывающих BBOX, — для выбора row group'ов. */
function quadkeyRange() {
  const [w, s, e, n] = BBOX;
  const keys = [];
  for (let x = lonToX(w); x <= lonToX(e); x += 1) {
    for (let y = latToY(n); y <= latToY(s); y += 1) keys.push(quadkey(x, y));
  }
  keys.sort();
  return [keys[0], keys.at(-1)];
}

/* ── Кварталы ──────────────────────────────────────────────────────────── */

async function listQuarters(type) {
  const found = [];
  for (let year = new Date().getFullYear(); year >= 2019 && found.length < QUARTERS; year -= 1) {
    const res = await fetch(`${BASE}/?list-type=2&prefix=parquet/performance/type=${type}/year=${year}/`);
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+\.parquet)<\/Key>/g)].map((m) => m[1]);
    for (const key of keys.sort().reverse()) {
      const q = key.match(/quarter=(\d)/)?.[1];
      if (q) found.push({ year, quarter: Number(q), key });
    }
  }
  return found.slice(0, QUARTERS);
}

/* ── Чтение ────────────────────────────────────────────────────────────── */

const toNumber = (v) => (typeof v === 'bigint' ? Number(v) : v);

async function readAstana({ key }) {
  const cachePath = join(CACHE, key.replaceAll('/', '_') + '.json');
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  const file = await asyncBufferFromUrl({ url: `${BASE}/${key}` });
  const metadata = await parquetMetadataAsync(file);
  const qkColumn = metadata.schema.slice(1).findIndex((c) => c.name === 'quadkey');
  const [lo, hi] = quadkeyRange();

  const rows = [];
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const count = Number(group.num_rows);
    const stats = group.columns[qkColumn].meta_data.statistics;
    const min = stats?.min_value ?? '';
    const max = stats?.max_value ?? '￿';

    if (max >= lo && min <= hi) {
      const part = await parquetReadObjects({
        file,
        metadata,
        columns: COLUMNS,
        rowStart,
        rowEnd: rowStart + count,
        compressors,
      });
      const [w, s, e, n] = BBOX;
      for (const r of part) {
        if (r.tile_x < w || r.tile_x > e || r.tile_y < s || r.tile_y > n) continue;
        rows.push([
          r.quadkey,
          Math.round(toNumber(r.avg_d_kbps) / 100) / 10, // Мбит/с, один знак
          Math.round(toNumber(r.avg_u_kbps) / 100) / 10,
          toNumber(r.avg_lat_ms),
          toNumber(r.tests),
          toNumber(r.devices),
        ]);
      }
    }
    rowStart += count;
  }

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(rows));
  return rows;
}

/* ── Районы ────────────────────────────────────────────────────────────── */

/**
 * Пять районов Астаны — отношения OpenStreetMap (admin_level=6). Список
 * стабилен, а Overpass часто отвечает таймаутом, поэтому id зашиты здесь,
 * а полигоны одним запросом берём у Nominatim.
 * Нура выделена из Есиля в 2022 году — после этого границы Есиля другие.
 */
const DISTRICT_RELATIONS = [3479876, 3482819, 3486954, 8593081, 20593940];

async function fetchDistricts() {
  const cachePath = join(CACHE, 'districts.geojson');
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  const ids = DISTRICT_RELATIONS.map((id) => `R${id}`).join(',');
  const res = await fetch(
    `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=geojson&polygon_geojson=1&polygon_threshold=0.0003&accept-language=ru`,
    { headers: { 'User-Agent': 'speedmap-astana/0.1 (local dev)' } }
  );
  if (!res.ok) throw new Error(`Nominatim: ${res.status}`);
  const geojson = await res.json();

  const districts = {
    type: 'FeatureCollection',
    features: geojson.features.map((f) => ({
      type: 'Feature',
      properties: { name: shortName(f.properties.name ?? f.properties.display_name) },
      geometry: f.geometry,
    })),
  };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(districts));
  return districts;
}

/** «Сарыаркинский район» / «район Сарыарка» → «Сарыарка». */
function shortName(name) {
  const known = ['Алматы', 'Байконыр', 'Есиль', 'Сарыарка', 'Нура'];
  const hit = known.find((k) => name.toLowerCase().includes(k.toLowerCase().slice(0, 5)));
  return hit ?? name.replace(/район/gi, '').trim();
}

function pointInPolygon([x, y], geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  });
}

function tileCenter(qk) {
  let x = 0;
  let y = 0;
  for (const ch of qk) {
    x = x * 2 + (Number(ch) & 1);
    y = y * 2 + (Number(ch) >> 1);
  }
  const n = 2 ** qk.length;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/* ── Сводки ────────────────────────────────────────────────────────────── */

/**
 * Средние по району взвешиваем по числу устройств, а не тестов. Ookla в своих
 * примерах берёт тесты, но в Астане есть тайлы, где пара десятков устройств
 * дала тысячи тестов (автоматический мониторинг или один упорный тестер) —
 * по тестам такой тайл перевешивает весь район. Устройства ближе к «среднему
 * жителю», а не к «среднему замеру».
 */
function summarize(rows) {
  let tests = 0;
  let devices = 0;
  let d = 0;
  let u = 0;
  let lat = 0;
  for (const [, down, up, latency, t, dev] of rows) {
    tests += t;
    devices += dev;
    d += down * dev;
    u += up * dev;
    lat += latency * dev;
  }
  if (!devices) return null;
  return {
    tiles: rows.length,
    tests,
    devices,
    download: Math.round((d / devices) * 10) / 10,
    upload: Math.round((u / devices) * 10) / 10,
    latency: Math.round(lat / devices),
  };
}

/* ── main ──────────────────────────────────────────────────────────────── */

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const districts = await fetchDistricts();
  writeFileSync(join(OUT, 'districts.geojson'), JSON.stringify(districts));
  console.log(`· районы: ${districts.features.map((f) => f.properties.name).join(', ')}`);

  const index = { city: 'Астана', bbox: BBOX, generatedAt: new Date().toISOString().slice(0, 10), datasets: [] };

  for (const type of TYPES) {
    for (const q of await listQuarters(type)) {
      const id = `${type}-${q.year}-q${q.quarter}`;
      process.stdout.write(`· ${id} … `);
      const rows = await readAstana(q);

      const byDistrict = {};
      for (const feature of districts.features) {
        const inside = rows.filter((r) => pointInPolygon(tileCenter(r[0]), feature.geometry));
        byDistrict[feature.properties.name] = summarize(inside);
      }

      writeFileSync(join(OUT, `${id}.json`), JSON.stringify(rows));
      index.datasets.push({
        id,
        type,
        year: q.year,
        quarter: q.quarter,
        file: `/data/${id}.json`,
        city: summarize(rows),
        districts: byDistrict,
      });
      console.log(`${rows.length} тайлов`);
    }
  }

  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log('→ public/data/index.json');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
