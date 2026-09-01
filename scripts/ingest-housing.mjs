/**
 * Тянет помесячные таблицы "Индексы цен и цены на рынке жилья" с stat.gov.kz
 * и раскладывает лист 2 ("Средние цены") в нормализованный ряд.
 *
 * Источник: Бюро национальной статистики АСПиР РК
 * Индекс:   /ru/industries/economy/prices/spreadsheets/?name=19521
 * Файл:     /api/iblock/element/{id}/file/ru/
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';

const INDEX_URL =
  'https://stat.gov.kz/ru/industries/economy/prices/spreadsheets/?name=19521';
const FILE_URL = (id) => `https://stat.gov.kz/api/iblock/element/${id}/file/ru/`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const CACHE = join(process.env.TMPDIR ?? '/tmp', 'statkz-housing-cache');
const OUT = new URL('../data/housing.json', import.meta.url).pathname;

// В заголовках БНС встречаются латинские двойники кириллицы ("cентябрь").
const HOMOGLYPHS = { c: 'с', e: 'е', a: 'а', o: 'о', p: 'р', y: 'у', x: 'х', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' };
const normalize = (s) =>
  s.toLowerCase().replace(/[ceaopyxkmtbh]/g, (ch) => HOMOGLYPHS[ch] ?? ch);

// Порядок важен: "мар" должен проверяться раньше "ма".
const MONTHS = [
  [/янв/, 1], [/фев/, 2], [/мар/, 3], [/апр/, 4], [/ма[йея]/, 5], [/июн/, 6],
  [/июл/, 7], [/авг/, 8], [/сент/, 9], [/окт/, 10], [/ноя/, 11], [/дек/, 12],
];

function parsePeriod(title) {
  const t = normalize(title);
  const year = t.match(/\b(19|20)\d{2}\b/)?.[0];
  const month = MONTHS.find(([re]) => re.test(t))?.[1];
  if (!year || !month) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function get(url, { binary = false } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

async function fetchFile(id) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${id}.xlsx`);
  if (existsSync(path)) return readFileSync(path);
  const buf = await get(FILE_URL(id), { binary: true });
  writeFileSync(path, buf);
  return buf;
}

/** Из индексной страницы достаём пары id → период. */
function extractEntries(html) {
  const re =
    /href="\/api\/iblock\/element\/(\d+)\/file\/ru\/"[^>]*>([\s\S]*?)<\/a>/g;
  const byPeriod = new Map();
  for (const [, id, raw] of html.matchAll(re)) {
    const title = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/рынке жилья/i.test(title)) continue;
    const period = parsePeriod(title);
    if (!period) {
      console.warn(`  ! период не распознан: ${title}`);
      continue;
    }
    // Один период может быть переопубликован — оставляем первое (свежее) вхождение.
    if (!byPeriod.has(period)) byPeriod.set(period, { id: Number(id), period, title });
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Ищем по всем листам таблицу средних цен: строку-заголовок с колонками
 * "Продажа нового жилья / Перепродажа / Арендная плата" и идущий за ней
 * непрерывный блок городов. Раскладка листов между выпусками менялась,
 * поэтому опираемся на заголовок, а не на имя листа.
 */
const COLUMNS = [
  ['newBuild', /продажа\s+нового\s+жиль/i],
  ['resale', /перепродаж/i],
  ['rent', /аренд/i],
];

function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const headerIndex = rows.findIndex((row) =>
    COLUMNS.every(([, re]) => row.some((c) => typeof c === 'string' && re.test(c)))
  );
  if (headerIndex === -1) return [];

  const header = rows[headerIndex];
  const columns = COLUMNS.map(([key, re]) => [
    key,
    header.findIndex((c) => typeof c === 'string' && re.test(c)),
  ]);

  const out = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const city = typeof row[0] === 'string' ? row[0].trim() : '';
    const values = Object.fromEntries(columns.map(([key, i]) => [key, num(row[i])]));
    // Таблица заканчивается там, где кончаются числа: дальше идут сноски и реквизиты.
    if (!city || values.newBuild == null) break;
    out.push({ city, ...values });
  }
  return out;
}

function parsePrices(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = parseSheet(wb.Sheets[name]);
    if (rows.length >= 10) return rows;
  }
  return [];
}

/** "108,31)" — сноска внутри числа; "х"/"…" — нет данных. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s/g, '').replace(/\d\)$/, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const main = async () => {
  console.log('· индексная страница');
  const entries = extractEntries(await get(INDEX_URL));
  console.log(`· найдено периодов: ${entries.length} (${entries.at(0)?.period} … ${entries.at(-1)?.period})`);

  const observations = [];
  for (const entry of entries) {
    try {
      const rows = parsePrices(await fetchFile(entry.id));
      if (!rows.length) {
        console.warn(`  ! ${entry.period}: лист со средними ценами не найден`);
        continue;
      }
      for (const row of rows) observations.push({ period: entry.period, ...row });
      console.log(`  ${entry.period}: ${rows.length} городов`);
    } catch (err) {
      console.warn(`  ! ${entry.period}: ${err.message}`);
    }
  }

  const cities = [...new Set(observations.map((o) => o.city))].sort();
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        metric: 'housing_prices_kzt_per_sqm',
        unit: 'тенге за 1 кв. м (аренда — за 1 кв. м в месяц)',
        source: 'Бюро национальной статистики АСПиР РК',
        sourceUrl: INDEX_URL,
        fetchedAt: new Date().toISOString().slice(0, 10),
        cities,
        observations,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\n→ ${observations.length} наблюдений, ${cities.length} городов → data/housing.json`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
