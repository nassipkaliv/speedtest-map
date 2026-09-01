/**
 * Длинные динамические ряды БНС АСПиР РК.
 *
 * 1640  Цены на рынке жилья по городам (2001–), три листа: новостройка / вторичка / аренда
 * 1641  Величина прожиточного минимума по регионам (1997–)
 * 56545 Динамические ряды по оплате труда — средняя зарплата по стране (1993–)
 * 5676  Среднемесячная зарплата по регионам (2011–)
 *
 * Каталог: /ru/industries/economy/prices/dynamic-tables/
 *          /ru/industries/labor-and-income/stat-wags/dynamic-tables/
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const FILE_URL = (id) => `https://stat.gov.kz/api/iblock/element/${id}/file/ru/`;
const CACHE = join(process.env.TMPDIR ?? '/tmp', 'statkz-dynamic-cache');
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const SOURCE = 'Бюро национальной статистики АСПиР РК';

async function fetchWorkbook(id) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${id}.xls`);
  if (!existsSync(path)) {
    const res = await fetch(FILE_URL(id), { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} для элемента ${id}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return XLSX.read(readFileSync(path), { type: 'buffer' });
}

/** "…", "-", "х" — пропуски; "1 234,5" — число; "108,31)" — число со сноской. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s| /g, '').replace(/\d\)$/, '').replace(',', '.');
  if (!/^-?\d/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const isYear = (v) => Number.isInteger(v) && v >= 1990 && v <= 2035;

/**
 * Разбирает лист вида «регион × год»: ищет строку заголовка с максимумом
 * годов, дальше читает строки, у которых в первой ячейке — название.
 */
function parseYearMatrix(sheet, { skip = [] } = {}) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  let headerIndex = -1;
  let best = 0;
  rows.forEach((row, i) => {
    const count = row.filter(isYear).length;
    if (count > best) {
      best = count;
      headerIndex = i;
    }
  });
  if (headerIndex === -1 || best < 5) return {};

  const years = rows[headerIndex]
    .map((v, i) => (isYear(v) ? { year: v, column: i } : null))
    .filter(Boolean);

  const out = {};
  for (const row of rows.slice(headerIndex + 1)) {
    const name = typeof row[0] === 'string' ? row[0].replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 60) continue;
    if (skip.some((re) => re.test(name))) continue;

    const values = {};
    for (const { year, column } of years) {
      const n = num(row[column]);
      if (n != null) values[year] = n;
    }
    // Ниже основной таблицы часто идёт её же копия в процентах к прошлому году.
    // Оставляем первое вхождение — оно в натуральных единицах.
    if (Object.keys(values).length && !(name in out)) out[name] = values;
  }
  return out;
}

const write = (file, payload) => {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, file), JSON.stringify(payload, null, 2) + '\n');
  console.log(`→ data/${file}`);
};

const fetchedAt = new Date().toISOString().slice(0, 10);

/* ── Жильё и аренда по городам ─────────────────────────────────────────── */
async function housingAnnual() {
  const wb = await fetchWorkbook(1640);
  const sheets = {
    newBuild: 'Продажа нового жилья',
    resale: 'Перепродажа жилья',
    rent: 'Аренда жилья',
  };

  const byCity = {};
  for (const [key, sheetName] of Object.entries(sheets)) {
    const parsed = parseYearMatrix(wb.Sheets[sheetName]);
    for (const [city, values] of Object.entries(parsed)) {
      (byCity[city] ??= {})[key] = values;
    }
  }

  write('housing-annual.json', {
    metric: 'housing_prices_kzt_per_sqm_annual',
    unit: 'тенге за 1 кв. м на конец года (аренда — за 1 кв. м в месяц)',
    source: SOURCE,
    sourceUrl: 'https://stat.gov.kz/ru/industries/economy/prices/dynamic-tables/',
    sourceElement: 1640,
    fetchedAt,
    cities: Object.keys(byCity).sort(),
    data: byCity,
  });
  return byCity;
}

/* ── Прожиточный минимум по регионам ───────────────────────────────────── */
async function subsistence() {
  const wb = await fetchWorkbook(1641);
  const data = parseYearMatrix(wb.Sheets['ВПМ']);
  write('subsistence.json', {
    metric: 'subsistence_minimum_kzt_per_month',
    unit: 'тенге в месяц на душу населения, в среднем за год',
    source: SOURCE,
    sourceUrl: 'https://stat.gov.kz/ru/industries/economy/prices/dynamic-tables/',
    sourceElement: 1641,
    fetchedAt,
    regions: Object.keys(data).sort(),
    data,
  });
  return data;
}

/* ── Средняя зарплата по стране, 1993– ─────────────────────────────────── */
async function wagesNational() {
  const wb = await fetchWorkbook(56545);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Оплата труда'], { header: 1, raw: true });

  const headerIndex = rows.findIndex((row) => row.filter(isYear).length > 10);
  const years = rows[headerIndex]
    .map((v, i) => (isYear(v) ? { year: v, column: i } : null))
    .filter(Boolean);

  // Строка с абсолютными значениями идёт сразу после подписи «в теңге».
  const wageRow = rows.find((row) => typeof row[0] === 'string' && /^те[нң]ге/i.test(row[0].trim()));
  if (!wageRow) throw new Error('строка с зарплатой в тенге не найдена');

  const values = {};
  for (const { year, column } of years) {
    const n = num(wageRow[column]);
    if (n != null) values[year] = n;
  }

  write('wages-national.json', {
    metric: 'average_monthly_nominal_wage_kzt',
    unit: 'тенге в месяц, номинал',
    source: SOURCE,
    sourceUrl: 'https://stat.gov.kz/ru/industries/labor-and-income/stat-wags/dynamic-tables/',
    sourceElement: 56545,
    fetchedAt,
    data: values,
  });
  return values;
}

/* ── Медианная зарплата по стране, 2019– ───────────────────────────────── */
/**
 * Средняя зарплата сильно завышена верхним хвостом (нефтегаз, топ-менеджмент).
 * Медиана честнее описывает «обычного человека», но публикуется только по
 * стране и только с 2019 года — используем её как поправочный коэффициент.
 */
async function wagesMedian() {
  const wb = await fetchWorkbook(5678);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Лист1'], { header: 1, raw: true });

  const yearRow = rows.find((row) => row.filter(isYear).length > 3);
  const genderRow = rows[rows.indexOf(yearRow) + 1];

  let current = null;
  const columns = [];
  genderRow.forEach((cell, i) => {
    if (isYear(yearRow[i])) current = yearRow[i];
    if (typeof cell === 'string' && /^всего$/i.test(cell.trim()) && current) {
      columns.push({ year: current, column: i });
    }
  });

  const totalRow = rows.find((row) => typeof row[0] === 'string' && /^всего$/i.test(row[0].trim()));
  if (!totalRow) throw new Error('строка «Всего» в медианной зарплате не найдена');

  const values = {};
  for (const { year, column } of columns) {
    const n = num(totalRow[column]);
    if (n != null) values[year] = Math.round(n);
  }

  write('wages-median-national.json', {
    metric: 'median_monthly_wage_kzt',
    unit: 'тенге в месяц, медиана по стране',
    source: SOURCE,
    sourceUrl: 'https://stat.gov.kz/ru/industries/labor-and-income/stat-wags/dynamic-tables/',
    sourceElement: 5678,
    fetchedAt,
    data: values,
  });
  return values;
}

/* ── Средняя зарплата по регионам, 2011– ───────────────────────────────── */
async function wagesRegional() {
  const wb = await fetchWorkbook(5676);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['период'], { header: 1, raw: true });

  // Заголовок двухуровневый: год в одной строке (с объединёнными ячейками),
  // период — в следующей. Нужны только столбцы «за год».
  const yearRow = rows.find((row) => row.filter(isYear).length > 5);
  const periodRow = rows[rows.indexOf(yearRow) + 1];

  let current = null;
  const columns = [];
  periodRow.forEach((cell, i) => {
    if (isYear(yearRow[i])) current = yearRow[i];
    if (typeof cell === 'string' && /^за\s*год$/i.test(cell.trim()) && current) {
      columns.push({ year: current, column: i });
    }
  });

  const data = {};
  for (const row of rows.slice(rows.indexOf(periodRow) + 1)) {
    const name = typeof row[0] === 'string' ? row[0].replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 60) continue;
    const values = {};
    for (const { year, column } of columns) {
      const n = num(row[column]);
      if (n != null) values[year] = Math.round(n);
    }
    if (Object.keys(values).length) data[name] = values;
  }

  write('wages-regional.json', {
    metric: 'average_monthly_nominal_wage_kzt_by_region',
    unit: 'тенге в месяц, номинал, в среднем за год',
    source: SOURCE,
    sourceUrl: 'https://stat.gov.kz/ru/industries/labor-and-income/stat-wags/dynamic-tables/',
    sourceElement: 5676,
    fetchedAt,
    regions: Object.keys(data).sort(),
    data,
  });
  return data;
}

const main = async () => {
  const housing = await housingAnnual();
  const vpm = await subsistence();
  const national = await wagesNational();
  const regional = await wagesRegional();
  const median = await wagesMedian();

  const span = (o) => {
    const y = Object.keys(o).map(Number).sort((a, b) => a - b);
    return `${y[0]}–${y.at(-1)}`;
  };
  console.log('\nСводка:');
  console.log(`  жильё:        ${Object.keys(housing).length} городов, ${span(Object.values(housing)[0].newBuild)}`);
  console.log(`  ПМ:           ${Object.keys(vpm).length} регионов, ${span(Object.values(vpm)[0])}`);
  console.log(`  зарплата РК:  ${span(national)}`);
  console.log(`  зарплата рег: ${Object.keys(regional).length} регионов, ${span(Object.values(regional)[0])}`);
  console.log(`  медиана РК:   ${span(median)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
