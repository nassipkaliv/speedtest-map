import housingAnnual from '@/data/housing-annual.json';
import subsistenceRaw from '@/data/subsistence.json';
import wagesNational from '@/data/wages-national.json';
import wagesRegional from '@/data/wages-regional.json';
import wagesMedian from '@/data/wages-median-national.json';

/**
 * Три ряда БНС называют одни и те же места по-разному: "Астана" / "город Астана"
 * / "г.Астана", у отдельных регионов в таблице ПМ висит сноска-звёздочка.
 * Приводим к общему ключу.
 */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(город|г\.)\s*/, '')
    .replace(/[^а-яёұіңғөүһә\s-]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Город → регион, к которому он относится в рядах зарплат и прожиточного
 * минимума. Списком, потому что в 2018 и 2022 годах менялась сетка областей:
 * Семей до 2022-го входил в ВКО, Жезказган — в Карагандинскую, и т.д.
 * Берём первый регион, по которому есть данные за нужный год.
 */
const CITY_REGIONS: Record<string, string[]> = {
  'Астана': ['Астана'],
  'Алматы': ['Алматы'],
  'Шымкент': ['Шымкент', 'Южно-Казахстанская'],
  'Актау': ['Мангистауская'],
  'Актобе': ['Актюбинская'],
  'Атырау': ['Атырауская'],
  'Жезказган': ['Ұлытау', 'Карагандинская'],
  'Караганда': ['Карагандинская'],
  'Кокшетау': ['Акмолинская'],
  'Конаев': ['Алматинская'],
  'Костанай': ['Костанайская'],
  'Кызылорда': ['Кызылординская'],
  'Павлодар': ['Павлодарская'],
  'Петропавловск': ['Северо-Казахстанская'],
  'Семей': ['Абай', 'Восточно-Казахстанская'],
  'Талдыкорган': ['Жетісу', 'Алматинская'],
  'Тараз': ['Жамбылская'],
  'Туркестан': ['Туркестанская', 'Южно-Казахстанская'],
  'Уральск': ['Западно-Казахстанская'],
  'Усть-Каменогорск': ['Восточно-Казахстанская'],
  'Республика Казахстан': ['Республика Казахстан'],
};

type YearMap = Record<string, number>;

const indexBy = (data: Record<string, YearMap>) =>
  new Map(Object.entries(data).map(([name, values]) => [key(name), values]));

const regionalWages = indexBy(wagesRegional.data as Record<string, YearMap>);
const subsistence = indexBy(subsistenceRaw.data as Record<string, YearMap>);
const nationalWages = wagesNational.data as YearMap;

const lookup = (index: Map<string, YearMap>, city: string, year: number) => {
  for (const region of CITY_REGIONS[city] ?? []) {
    const value = index.get(key(region))?.[year];
    if (value != null) return value;
  }
  return null;
};

/**
 * Ряд зарплат по регионам начинается с 2011 года, цены на жильё — с 2001-го.
 * Для 2001–2010 масштабируем республиканскую зарплату на устойчивое
 * соотношение "регион / страна", посчитанное по первым доступным годам.
 * Такие значения помечаем как оценку и показываем это в интерфейсе.
 */
function regionRatio(city: string): number | null {
  const samples: number[] = [];
  for (let year = 2011; year <= 2015; year += 1) {
    const regional = lookup(regionalWages, city, year);
    const national = nationalWages[year];
    if (regional != null && national) samples.push(regional / national);
  }
  if (!samples.length) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * Медиана публикуется только по стране и только с 2019 года. Приводим её к
 * коэффициенту «медиана / средняя» и применяем к региональной средней.
 * Для лет до 2019-го берём самый ранний известный коэффициент — это
 * экстраполяция, и интерфейс обязан её подписать.
 */
function medianRatio(year: number): { ratio: number; extrapolated: boolean } {
  const median = wagesMedian.data as YearMap;
  const known = Object.keys(median)
    .map(Number)
    .filter((y) => nationalWages[y] != null)
    .sort((a, b) => a - b);

  const nearest = median[year] != null ? year : known[0];
  return {
    ratio: median[nearest] / nationalWages[nearest],
    extrapolated: median[year] == null,
  };
}

export type CitySeries = {
  /** Цена вторичного жилья, ₸/м². Вторичка — это то, что реально покупают первой. */
  price: (number | null)[];
  /** Аренда благоустроенного жилья, ₸ за м² в месяц. */
  rent: (number | null)[];
  /** Среднемесячная номинальная зарплата, ₸. */
  wage: (number | null)[];
  /** true, если зарплата получена пересчётом от республиканской. */
  wageEstimated: boolean[];
  /** Оценка медианной зарплаты в регионе. */
  wageMedian: (number | null)[];
  /** true, если коэффициент медианы экстраполирован на ранние годы. */
  wageMedianExtrapolated: boolean[];
  /** Прожиточный минимум, ₸/мес. */
  subsistence: (number | null)[];
};

export type Dataset = {
  years: number[];
  cities: string[];
  series: Record<string, CitySeries>;
  sources: { label: string; url: string }[];
  fetchedAt: string;
};

export function buildDataset(): Dataset {
  const housing = housingAnnual.data as Record<
    string,
    { newBuild?: YearMap; resale?: YearMap; rent?: YearMap }
  >;

  const years: number[] = [];
  for (const values of Object.values(housing)) {
    for (const year of Object.keys(values.newBuild ?? {})) years.push(Number(year));
  }
  const span = [...new Set(years)].sort((a, b) => a - b);

  const cities = Object.keys(housing)
    .filter((city) => city in CITY_REGIONS)
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const series: Record<string, CitySeries> = {};
  for (const city of cities) {
    const rows = housing[city];
    const ratio = regionRatio(city);

    series[city] = {
      // До 2005 года вторичка публиковалась не по всем городам — тогда берём новостройку.
      price: span.map((year) => rows.resale?.[year] ?? rows.newBuild?.[year] ?? null),
      rent: span.map((year) => rows.rent?.[year] ?? null),
      wage: span.map((year) => {
        const exact = lookup(regionalWages, city, year);
        if (exact != null) return exact;
        const national = nationalWages[year];
        if (national == null) return null;
        return ratio == null ? national : Math.round(national * ratio);
      }),
      wageEstimated: span.map((year) => lookup(regionalWages, city, year) == null),
      wageMedian: span.map((year) => {
        const exact = lookup(regionalWages, city, year);
        const national = nationalWages[year];
        const average = exact ?? (national == null || ratio == null ? national : national * ratio);
        if (average == null) return null;
        return Math.round(average * medianRatio(year).ratio);
      }),
      wageMedianExtrapolated: span.map((year) => medianRatio(year).extrapolated),
      subsistence: span.map((year) => lookup(subsistence, city, year)),
    };
  }

  return {
    years: span,
    cities,
    series,
    fetchedAt: housingAnnual.fetchedAt,
    sources: [
      { label: 'Цены на рынке жилья и аренда, 2001–', url: 'https://stat.gov.kz/ru/industries/economy/prices/dynamic-tables/' },
      { label: 'Среднемесячная зарплата по регионам', url: 'https://stat.gov.kz/ru/industries/labor-and-income/stat-wags/dynamic-tables/' },
      { label: 'Величина прожиточного минимума', url: 'https://stat.gov.kz/ru/industries/economy/prices/dynamic-tables/' },
      { label: 'Медианная заработная плата', url: 'https://stat.gov.kz/ru/industries/labor-and-income/stat-wags/dynamic-tables/' },
    ],
  };
}
