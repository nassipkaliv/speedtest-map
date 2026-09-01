'use client';

import { useMemo, useState } from 'react';
import type { Dataset } from '@/lib/data';
import {
  describeChange,
  metricsFor,
  percent,
  sqm,
  tenge,
  years1,
  yearsToBuySeries,
  type Metrics,
  type WageKind,
} from '@/lib/calc';
import { TrendChart } from './trend-chart';

const AREAS = [
  { value: 40, label: 'однушка · 40 м²' },
  { value: 55, label: 'двушка · 55 м²' },
  { value: 75, label: 'трёшка · 75 м²' },
];

export function Calculator({ dataset }: { dataset: Dataset }) {
  const latest = dataset.years[dataset.years.length - 1];
  const earliest = dataset.years[0];

  const [city, setCity] = useState('Астана');
  const [area, setArea] = useState(40);
  const [thenYear, setThenYear] = useState(earliest);
  const [wageInput, setWageInput] = useState('');
  const [wageKind, setWageKind] = useState<WageKind>('median');

  const series = dataset.series[city];
  const wageOverride = wageInput.trim() === '' ? null : Number(wageInput.replace(/\s/g, ''));
  const usesOwnWage = wageOverride != null && Number.isFinite(wageOverride) && wageOverride > 0;

  const now = metricsFor(
    series,
    dataset.years,
    latest,
    area,
    usesOwnWage ? wageOverride : null,
    wageKind
  );
  const then = metricsFor(series, dataset.years, thenYear, area, null, wageKind);

  const trend = useMemo(
    () => yearsToBuySeries(series, dataset.years, area, wageKind),
    [series, dataset.years, area, wageKind]
  );

  if (!now || !then) return null;

  const buy = describeChange(then.yearsToBuy, now.yearsToBuy);

  return (
    <div className="flex flex-col gap-10">
      <Controls
        dataset={dataset}
        city={city}
        onCity={setCity}
        area={area}
        onArea={setArea}
        thenYear={thenYear}
        onThenYear={setThenYear}
        wageInput={wageInput}
        onWage={setWageInput}
        wageKind={wageKind}
        onWageKind={setWageKind}
        latest={latest}
      />

      <section className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
        <h2 className="text-sm font-medium tracking-wide text-secondary uppercase">
          Годы работы на квартиру
        </h2>
        <p className="mt-1 text-sm text-muted">
          {AREAS.find((a) => a.value === area)?.label}, вторичный рынок, если откладывать
          весь доход целиком
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <BigNumber
            caption={`${latest} год${usesOwnWage ? ' · твоя зарплата' : ''}`}
            value={years1(now.yearsToBuy)}
            unit="года"
            tone={buy.worse ? 'critical' : 'normal'}
          />
          <BigNumber caption={`${thenYear} год`} value={years1(then.yearsToBuy)} unit="года" />
        </div>

        <p className="mt-6 text-base text-secondary">
          Купить квартиру в городе {cityIn(city)} стало{' '}
          <strong className={buy.worse ? 'text-critical' : 'text-primary'}>{buy.text}</strong>,
          чем в {thenYear} году.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          title="Аренда съедает"
          now={now.rentShare == null ? '—' : percent(now.rentShare)}
          then={then.rentShare == null ? '—' : percent(then.rentShare)}
          thenYear={thenYear}
          note="доля зарплаты за аренду такой же площади"
        />
        <StatTile
          title="Метров за зарплату"
          now={sqm(now.sqmPerWage)}
          then={sqm(then.sqmPerWage)}
          thenYear={thenYear}
          note="сколько м² покупает одна месячная зарплата"
        />
        <StatTile
          title="Зарплата к минимуму"
          now={now.overSubsistence == null ? '—' : `${years1(now.overSubsistence)}×`}
          then={then.overSubsistence == null ? '—' : `${years1(then.overSubsistence)}×`}
          thenYear={thenYear}
          note="во сколько раз доход выше прожиточного минимума"
        />
      </div>

      <section className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
        <TrendChart
          points={trend}
          markers={[thenYear, latest]}
          label={`Сколько лет уходит на квартиру ${area} м² — ${city}, ${earliest}–${latest}`}
        />
      </section>

      <Breakdown city={city} now={now} then={then} area={area} />
    </div>
  );
}

function Controls({
  dataset,
  city,
  onCity,
  area,
  onArea,
  thenYear,
  onThenYear,
  wageInput,
  onWage,
  wageKind,
  onWageKind,
  latest,
}: {
  dataset: Dataset;
  city: string;
  onCity: (v: string) => void;
  area: number;
  onArea: (v: number) => void;
  thenYear: number;
  onThenYear: (v: number) => void;
  wageInput: string;
  onWage: (v: string) => void;
  wageKind: WageKind;
  onWageKind: (v: WageKind) => void;
  latest: number;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Field label="Город">
        <select
          value={city}
          onChange={(e) => onCity(e.target.value)}
          className="h-10 rounded-md border border-border bg-surface-1 px-3 text-sm"
        >
          {dataset.cities.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Квартира">
        <div className="flex rounded-md border border-border bg-surface-1 p-0.5">
          {AREAS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onArea(option.value)}
              className={`h-9 rounded px-3 text-sm transition-colors ${
                area === option.value
                  ? 'bg-accent-soft font-medium text-primary'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {option.value} м²
            </button>
          ))}
        </div>
      </Field>

      <Field label="Сравнить с">
        <select
          value={thenYear}
          onChange={(e) => onThenYear(Number(e.target.value))}
          className="h-10 rounded-md border border-border bg-surface-1 px-3 text-sm tnum"
        >
          {dataset.years
            .filter((year) => year < latest)
            .map((year) => (
              <option key={year} value={year}>
                {year} год
              </option>
            ))}
        </select>
      </Field>

      <Field label="Чья зарплата">
        <div className="flex rounded-md border border-border bg-surface-1 p-0.5">
          {([
            ['median', 'медианная'],
            ['average', 'средняя'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onWageKind(value)}
              className={`h-9 rounded px-3 text-sm transition-colors ${
                wageKind === value
                  ? 'bg-accent-soft font-medium text-primary'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Твоя зарплата, ₸/мес">
        <input
          value={wageInput}
          onChange={(e) => onWage(e.target.value.replace(/[^\d\s]/g, ''))}
          inputMode="numeric"
          placeholder="средняя по городу"
          className="tnum h-10 w-48 rounded-md border border-border bg-surface-1 px-3 text-sm placeholder:text-muted"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

function BigNumber({
  caption,
  value,
  unit,
  tone = 'normal',
}: {
  caption: string;
  value: string;
  unit: string;
  tone?: 'normal' | 'critical';
}) {
  return (
    <div>
      <div className="text-sm text-muted">{caption}</div>
      <div
        className={`tnum mt-1 text-6xl leading-none font-semibold ${
          tone === 'critical' ? 'text-critical' : 'text-primary'
        }`}
      >
        {value}
        <span className="ml-2 text-2xl font-normal text-secondary">{unit}</span>
      </div>
    </div>
  );
}

function StatTile({
  title,
  now,
  then,
  thenYear,
  note,
}: {
  title: string;
  now: string;
  then: string;
  thenYear: number;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5">
      <div className="text-sm font-medium text-secondary">{title}</div>
      <div className="tnum mt-3 text-3xl font-semibold">{now}</div>
      <div className="tnum mt-1 text-sm text-muted">
        было {then} в {thenYear}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function Breakdown({
  city,
  now,
  then,
  area,
}: {
  city: string;
  now: Metrics;
  then: Metrics;
  area: number;
}) {
  const rows: [string, string, string][] = [
    ['Цена вторичного жилья, ₸/м²', tenge(now.price), tenge(then.price)],
    [`Такая квартира целиком (${area} м²)`, tenge(now.price * area), tenge(then.price * area)],
    ['Зарплата, ₸/мес', tenge(now.wage), tenge(then.wage)],
    [
      'Аренда, ₸/м² в месяц',
      now.rent == null ? '—' : tenge(now.rent),
      then.rent == null ? '—' : tenge(then.rent),
    ],
    [
      'Прожиточный минимум',
      now.subsistence == null ? '—' : tenge(now.subsistence),
      then.subsistence == null ? '—' : tenge(then.subsistence),
    ],
  ];

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-wide text-secondary uppercase">
        Из чего это посчитано — {city}
      </h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-5 py-3 font-medium text-muted">Показатель</th>
              <th className="tnum px-5 py-3 font-medium text-muted">{now.year}</th>
              <th className="tnum px-5 py-3 font-medium text-muted">{then.year}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label} className="border-b border-border last:border-0">
                <td className="px-5 py-3 text-secondary">{label}</td>
                <td className="tnum px-5 py-3">{a}</td>
                <td className="tnum px-5 py-3">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted">
        {(now.wageEstimated || then.wageEstimated) && (
          <p>
            Зарплата по регионам публикуется с 2011 года. За более ранние годы показан пересчёт
            республиканской зарплаты на устойчивое соотношение «регион / страна» — это оценка,
            а не прямое наблюдение.
          </p>
        )}
        {(now.wageMedianExtrapolated || then.wageMedianExtrapolated) && (
          <p>
            Медианная зарплата публикуется только по стране и только с 2019 года. Для более
            ранних лет применён самый ранний известный коэффициент «медиана / средняя» — это
            экстраполяция.
          </p>
        )}
      </div>
    </section>
  );
}

/** «в городе Астане» — предложный падеж для пары городов, где он заметен. */
function cityIn(city: string): string {
  const special: Record<string, string> = {
    'Астана': 'Астане',
    'Алматы': 'Алматы',
    'Караганда': 'Караганде',
    'Кызылорда': 'Кызылорде',
    'Республика Казахстан': 'Казахстан (в среднем)',
  };
  return special[city] ?? city;
}
