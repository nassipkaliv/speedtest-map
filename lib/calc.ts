import type { CitySeries } from './data';

export type WageKind = 'average' | 'median';

export type Metrics = {
  year: number;
  wage: number;
  wageEstimated: boolean;
  wageMedianExtrapolated: boolean;
  price: number;
  rent: number | null;
  subsistence: number | null;
  /** Сколько лет уходит на квартиру, если откладывать весь доход целиком. */
  yearsToBuy: number;
  /** Какую долю дохода съедает аренда такой же площади. */
  rentShare: number | null;
  /** Сколько квадратных метров покупает одна месячная зарплата. */
  sqmPerWage: number;
  /** Во сколько раз доход больше прожиточного минимума. */
  overSubsistence: number | null;
};

export function metricsFor(
  series: CitySeries,
  years: number[],
  year: number,
  area: number,
  wageOverride?: number | null,
  wageKind: WageKind = 'average'
): Metrics | null {
  const i = years.indexOf(year);
  if (i === -1) return null;

  const price = series.price[i];
  const baseWage = wageKind === 'median' ? series.wageMedian[i] : series.wage[i];
  if (price == null || baseWage == null) return null;

  const wage = wageOverride ?? baseWage;
  const rent = series.rent[i];
  const subsistence = series.subsistence[i];

  return {
    year,
    wage,
    wageEstimated: wageOverride == null && series.wageEstimated[i],
    wageMedianExtrapolated:
      wageOverride == null && wageKind === 'median' && series.wageMedianExtrapolated[i],
    price,
    rent,
    subsistence,
    yearsToBuy: (price * area) / (wage * 12),
    rentShare: rent == null ? null : (rent * area) / wage,
    sqmPerWage: wage / price,
    overSubsistence: subsistence == null ? null : wage / subsistence,
  };
}

/** Ряд «лет на квартиру» по всем годам — для графика. */
export function yearsToBuySeries(
  series: CitySeries,
  years: number[],
  area: number,
  wageKind: WageKind = 'average'
): { year: number; value: number }[] {
  return years.flatMap((year, i) => {
    const price = series.price[i];
    const wage = wageKind === 'median' ? series.wageMedian[i] : series.wage[i];
    if (price == null || wage == null) return [];
    return [{ year, value: (price * area) / (wage * 12) }];
  });
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const tenge = (v: number) => `${nf.format(Math.round(v))} ₸`;
export const years1 = (v: number) => v.toFixed(1).replace('.', ',');
export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const sqm = (v: number) => `${v.toFixed(2).replace('.', ',')} м²`;

/** «в 2,4 раза больше» / «на 18% меньше» — человеческая формулировка изменения. */
export function describeChange(from: number, to: number): { text: string; worse: boolean } {
  const ratio = to / from;
  if (ratio >= 1.15) return { text: `в ${years1(ratio)} раза больше`, worse: true };
  if (ratio <= 0.87) return { text: `в ${years1(1 / ratio)} раза меньше`, worse: false };
  const delta = Math.round((ratio - 1) * 100);
  if (delta === 0) return { text: 'почти без изменений', worse: false };
  return {
    text: `${delta > 0 ? 'на' : 'на'} ${Math.abs(delta)}% ${delta > 0 ? 'больше' : 'меньше'}`,
    worse: delta > 0,
  };
}
