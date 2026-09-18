'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import type { FeatureCollection } from 'geojson';
import { MapCanvas, type Padding, type TileHover } from './map-canvas';
import {
  RELIABLE_TESTS,
  TIERS,
  count,
  delta,
  mbps,
  plural,
  quarterLabel,
  tierOf,
  tilesToGeoJSON,
  type DataIndex,
  type Dataset,
  type NetworkType,
  type Summary,
  type TileRow,
} from '@/lib/tiles';

const TYPES: { value: NetworkType; label: string }[] = [
  { value: 'fixed', label: 'Домашний' },
  { value: 'mobile', label: 'Мобильный' },
];

const periodOf = (d: Dataset) => `${d.year}-q${d.quarter}`;

export function SpeedMap({ index }: { index: DataIndex }) {
  const [type, setType] = useState<NetworkType>('fixed');
  const [period, setPeriod] = useState<string | null>(null);

  const series = useMemo(
    () =>
      index.datasets
        .filter((d) => d.type === type)
        .sort((a, b) => a.year - b.year || a.quarter - b.quarter),
    [index.datasets, type]
  );
  const position = Math.max(
    0,
    period == null ? series.length - 1 : series.findIndex((d) => periodOf(d) === period)
  );
  const dataset = series[position] ?? series[series.length - 1];
  const previous = position > 0 ? series[position - 1] : null;

  const [tiles, setTiles] = useState<FeatureCollection | null>(null);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<TileHover | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ name: string; nonce: number } | null>(null);
  const [padding, setPadding] = useState<Padding | null>(null);

  const overviewRef = useRef<HTMLElement>(null);
  const districtsRef = useRef<HTMLElement>(null);

  /**
   * Панели лежат поверх карты, поэтому город надо вписывать в оставшуюся
   * часть экрана: на десктопе — между панелями, на телефоне — под сводкой.
   * Меряем после того, как таблица районов на телефоне свернулась.
   */
  useEffect(() => {
    const measure = () => {
      const o = overviewRef.current?.getBoundingClientRect();
      const d = districtsRef.current?.getBoundingClientRect();
      if (!o || !d) return;
      const { innerWidth: w, innerHeight: h } = window;
      setPadding(
        w >= 640
          ? { top: 0, bottom: 0, left: o.right, right: w - d.left }
          : { top: o.bottom, bottom: h - d.top, left: 0, right: 0 }
      );
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(measure)));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(dataset.file)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: TileRow[]) => active && (setTiles(tilesToGeoJSON(rows)), setFailed(false)))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [dataset.file]);

  useEffect(() => {
    fetch('/data/districts.geojson')
      .then((r) => r.json())
      .then(setDistricts)
      .catch(() => setDistricts(null));
  }, []);

  const quarters = series.map((d) => quarterLabel(d.year, d.quarter));
  const attribution = `<a href="https://github.com/teamookla/ookla-open-data" target="_blank" rel="noreferrer">Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps</a>. Based on analysis by Ookla of Speedtest Intelligence® data for ${quarters[0]} – ${quarters.at(-1)}. Provided by Ookla and accessed ${index.generatedAt}. Ookla trademarks used under license and reprinted with permission.`;

  return (
    <main className="fixed inset-0 overflow-hidden bg-surface-0 text-primary">
      <MapCanvas
        bbox={index.bbox}
        tiles={tiles}
        districts={districts}
        highlightedDistrict={highlighted}
        focus={focus}
        attribution={attribution}
        padding={padding}
        onHover={setHover}
      />

      {/* z-10: контролы MapLibre сами по себе z-index 2 и иначе оказываются поверх панелей. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
        <Overview
          panelRef={overviewRef}
          type={type}
          onType={setType}
          series={series}
          dataset={dataset}
          previous={previous}
          onPeriod={setPeriod}
          loading={!tiles && !failed}
          failed={failed}
        />
        <Districts
          panelRef={districtsRef}
          dataset={dataset}
          previous={previous}
          onHighlight={setHighlighted}
          onFocus={(name) => setFocus({ name, nonce: Date.now() })}
        />
      </div>

      {hover && <Tooltip hover={hover} />}
    </main>
  );
}

/* ── Сводка по городу ──────────────────────────────────────────────────── */

function Overview({
  panelRef,
  type,
  onType,
  series,
  dataset,
  previous,
  onPeriod,
  loading,
  failed,
}: {
  panelRef: Ref<HTMLElement>;
  type: NetworkType;
  onType: (t: NetworkType) => void;
  series: Dataset[];
  dataset: Dataset;
  previous: Dataset | null;
  onPeriod: (p: string) => void;
  loading: boolean;
  failed: boolean;
}) {
  const city = dataset.city;
  const change = previous ? delta(city.download, previous.city.download) : null;

  return (
    <section
      ref={panelRef}
      className="panel pointer-events-auto flex max-h-[55vh] w-full flex-col gap-3 overflow-y-auto sm:max-h-[calc(100vh-2rem)] sm:w-[360px] sm:gap-4"
    >
      <header>
        <p className="hidden text-xs font-medium tracking-[0.14em] text-muted uppercase sm:block">
          Астана · интернет
        </p>
        <h1 className="text-lg font-semibold tracking-tight sm:mt-1 sm:text-xl">Где интернет быстрый, а где нет</h1>
      </header>

      <div className="flex flex-col gap-1.5 sm:gap-2">
        <Segmented options={TYPES} value={type} onChange={onType} label="Тип подключения" />
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Квартал">
          {series.map((d) => {
            const active = d.id === dataset.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onPeriod(periodOf(d))}
                aria-pressed={active}
                className={`h-8 rounded-md px-1 text-xs whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-accent-soft font-medium text-primary'
                    : 'text-secondary hover:bg-white/5 hover:text-primary'
                }`}
              >
                {quarterLabel(d.year, d.quarter)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-sm text-muted">Средняя загрузка по городу</div>
        {/* На телефоне отдача и пинг встают справа от главной цифры, на десктопе — под ней. */}
        <div className="mt-1 flex items-end justify-between gap-4 sm:block">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-4xl leading-none font-semibold sm:text-5xl">{mbps(city.download)}</span>
              <span className="text-base text-secondary sm:text-lg">Мбит/с</span>
            </div>
            {change && (
              <div className="mt-2 text-sm whitespace-nowrap text-secondary">
                <span className="text-primary">
                  {change.pct >= 0 ? '▲' : '▼'} {change.text}
                </span>{' '}
                к {quarterLabel(previous!.year, previous!.quarter)}
              </div>
            )}
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-3 sm:mt-4">
            <Stat term="Отдача" value={`${mbps(city.upload)} Мбит/с`} />
            <Stat term="Пинг" value={`${city.latency} мс`} />
          </dl>
        </div>
      </div>

      <p className="hidden text-xs text-muted sm:block">
        {count(city.devices)} {plural(city.devices, ['устройство', 'устройства', 'устройств'])} ·{' '}
        {count(city.tests)} {plural(city.tests, ['тест', 'теста', 'тестов'])} · {count(city.tiles)}{' '}
        {plural(city.tiles, ['квадрат', 'квадрата', 'квадратов'])}
      </p>
      {loading && <p className="text-xs text-muted">Загружаю квадраты…</p>}
      {failed && <p className="text-xs text-secondary">Не удалось загрузить квадраты этого квартала.</p>}

      <Legend />

      <p className="text-xs leading-relaxed text-muted">
        <span className="hidden sm:inline">
          Квадрат ≈ 610 × 385 м — среднее по всем тестам в нём за квартал. Пусто — там никто не запускал тест.{' '}
        </span>
        Данные Speedtest® by Ookla®, карта © OpenStreetMap. Подробнее — ⓘ в углу карты.
      </p>
    </section>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="mt-0.5 text-base font-medium whitespace-nowrap sm:text-lg">{value}</dd>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`h-9 flex-1 rounded-md text-sm transition-colors ${
            value === o.value ? 'bg-accent-soft font-medium text-primary' : 'text-secondary hover:text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-xs text-muted">Загрузка, Мбит/с</figcaption>
      <div className="flex gap-0.5">
        {TIERS.map((t) => (
          <div key={t.range} className="flex-1">
            <div className="h-2.5 rounded-sm" style={{ background: t.color }} />
            <div className="tnum mt-1.5 text-[11px] text-secondary">{t.range}</div>
          </div>
        ))}
      </div>
    </figure>
  );
}

/* ── Районы ────────────────────────────────────────────────────────────── */

function Districts({
  panelRef,
  dataset,
  previous,
  onHighlight,
  onFocus,
}: {
  panelRef: Ref<HTMLElement>;
  dataset: Dataset;
  previous: Dataset | null;
  onHighlight: (name: string | null) => void;
  onFocus: (name: string) => void;
}) {
  // На телефоне таблица по умолчанию свёрнута — иначе она закрывает карту.
  // Пока пользователь сам не нажал, состояние следует за шириной экрана.
  const small = useIsSmallScreen();
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !small;
  const setOpen = (update: (v: boolean) => boolean) => setChoice(update(open));

  const rows = Object.entries(dataset.districts)
    .filter((entry): entry is [string, Summary] => entry[1] != null)
    .sort((a, b) => b[1].download - a[1].download);

  return (
    <section ref={panelRef} className="panel pointer-events-auto mt-auto w-full sm:mt-0 sm:w-[340px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <span>
          <span className="text-base font-semibold">Районы</span>
          <span className="ml-2 text-xs text-muted">{quarterLabel(dataset.year, dataset.quarter)}</span>
        </span>
        <span className="text-xs text-muted">{open ? 'свернуть' : 'показать'}</span>
      </button>

      {open && (
        <>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-normal">Район</th>
                <th className="pb-2 text-right font-normal">Загрузка</th>
                <th className="pb-2 text-right font-normal">Отдача</th>
                <th className="pb-2 text-right font-normal">Пинг</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, s]) => {
                const before = previous?.districts[name];
                const change = before ? delta(s.download, before.download) : null;
                return (
                  <tr
                    key={name}
                    className="border-t border-border hover:bg-white/[0.04]"
                    onMouseEnter={() => onHighlight(name)}
                    onMouseLeave={() => onHighlight(null)}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onFocus(name)}
                        onFocus={() => onHighlight(name)}
                        onBlur={() => onHighlight(null)}
                        className="flex items-center gap-2 text-left hover:underline"
                        title="Показать на карте"
                      >
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: tierOf(s.download).color }} />
                        {name}
                      </button>
                    </td>
                    <td className="tnum py-2 text-right">
                      {mbps(s.download)}
                      {change && <div className="text-[11px] text-muted">{change.text}</div>}
                    </td>
                    <td className="tnum py-2 text-right text-secondary">{mbps(s.upload)}</td>
                    <td className="tnum py-2 text-right text-secondary">{s.latency} мс</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Мбит/с, средние по району взвешены по числу устройств, а не тестов — так пара автоматических
            «тестеров» с тысячами замеров не перекашивает район. Изменение — к прошлому кварталу.
          </p>
        </>
      )}
    </section>
  );
}

const SMALL_SCREEN = '(max-width: 639px)';

function useIsSmallScreen() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(SMALL_SCREEN);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(SMALL_SCREEN).matches,
    () => false
  );
}

/* ── Подсказка над квадратом ───────────────────────────────────────────── */

function Tooltip({ hover }: { hover: TileHover }) {
  const { d, u, l, t, v } = hover.props;
  const tier = tierOf(d);
  const flip = typeof window !== 'undefined' && hover.x > window.innerWidth - 260;

  return (
    <div
      className="pointer-events-none absolute z-20 w-56 rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm shadow-lg"
      style={{ left: flip ? hover.x - 14 - 224 : hover.x + 14, top: hover.y + 14 }}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: tier.color }} />
        <span className="font-medium">{tier.label}</span>
      </div>
      <div className="tnum mt-1.5">
        ↓ {mbps(d)} <span className="text-secondary">Мбит/с</span> · ↑ {mbps(u)}
      </div>
      <div className="tnum text-secondary">пинг {l} мс</div>
      <div className="mt-1 text-xs text-muted">
        {t} {plural(t, ['тест', 'теста', 'тестов'])} · {v} {plural(v, ['устройство', 'устройства', 'устройств'])}
      </div>
      {t < RELIABLE_TESTS && <div className="mt-1 text-xs text-secondary">Мало тестов — значение ненадёжное</div>}
    </div>
  );
}
