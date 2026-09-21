'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { reverseGeocode, type Place } from '@/lib/geocode';
import {
  NETWORKS,
  districtAt,
  indexTiles,
  mbps,
  plural,
  quarterLabel,
  readingAt,
  tierOf,
  tilesToPoints,
  type DataIndex,
  type Dataset,
  type NetworkType,
  type TileRow,
} from '@/lib/tiles';
import { AboutDialog } from './about-dialog';
import { CitySummary } from './city-summary';
import { DistrictList } from './district-list';
import { Legend } from './legend';
import { MapCanvas, type LngLat, type MapController, type Padding, type TileHover } from './map-canvas';
import { PlaceCard, type Readings } from './place-card';
import { SearchBox } from './search-box';
import { Timeline } from './timeline';
import { ExpandIcon, HelpIcon, LocateIcon, MapButton, MinusIcon, PlusIcon, Segmented } from './ui';

const TYPE_OPTIONS = (Object.keys(NETWORKS) as NetworkType[]).map((value) => ({
  value,
  label: NETWORKS[value].short,
}));

const periodOf = (d: Dataset) => `${d.year}-q${d.quarter}`;
const DESKTOP = 1024;

export function SpeedMap({ index }: { index: DataIndex }) {
  const [type, setType] = useState<NetworkType>('fixed');
  const [period, setPeriod] = useState<string | null>(null);

  const seriesOf = useCallback(
    (t: NetworkType) =>
      index.datasets.filter((d) => d.type === t).sort((a, b) => a.year - b.year || a.quarter - b.quarter),
    [index.datasets]
  );
  const series = useMemo(() => seriesOf(type), [seriesOf, type]);
  const position = period == null ? series.length - 1 : Math.max(0, series.findIndex((d) => periodOf(d) === period));
  const dataset = series[position];
  const previous = position > 0 ? series[position - 1] : null;
  const activePeriod = periodOf(dataset);

  // Для карточки места нужны оба типа сети за один и тот же квартал.
  const pair = useMemo(() => {
    const find = (t: NetworkType) => seriesOf(t).find((d) => periodOf(d) === activePeriod) ?? null;
    return { fixed: find('fixed'), mobile: find('mobile') };
  }, [seriesOf, activePeriod]);

  /* ── Данные ─────────────────────────────────────────────────────────── */

  const [rows, setRows] = useState<Record<string, TileRow[]>>({});
  const [failed, setFailed] = useState(false);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);

  // Файлы кварталов кэшируются по имени; запрошенные помним, чтобы не качать дважды.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const d of [pair.fixed, pair.mobile]) {
      if (!d || requested.current.has(d.file)) continue;
      requested.current.add(d.file);
      fetch(d.file)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: TileRow[]) => setRows((prev) => ({ ...prev, [d.file]: data })))
        .catch(() => {
          requested.current.delete(d.file);
          setFailed(true);
        });
    }
  }, [pair]);

  useEffect(() => {
    fetch('/data/districts.geojson')
      .then((r) => r.json())
      .then(setDistricts)
      .catch(() => setDistricts(null));
  }, []);

  const points = useMemo(() => (rows[dataset.file] ? tilesToPoints(rows[dataset.file]) : null), [rows, dataset.file]);
  const indexes = useMemo(
    () => ({
      fixed: pair.fixed && rows[pair.fixed.file] ? indexTiles(rows[pair.fixed.file]) : null,
      mobile: pair.mobile && rows[pair.mobile.file] ? indexTiles(rows[pair.mobile.file]) : null,
    }),
    [pair, rows]
  );

  /* ── Выбранное место ────────────────────────────────────────────────── */

  const map = useRef<MapController>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reverse = useRef<AbortController | null>(null);

  const readings: Readings | null = useMemo(() => {
    if (!place) return null;
    const read = (t: NetworkType) => {
      if (!pair[t]) return null;
      const idx = indexes[t];
      return idx ? readingAt(idx, place.lon, place.lat) : undefined;
    };
    return { fixed: read('fixed'), mobile: read('mobile') };
  }, [place, pair, indexes]);

  const placeDistrict = place ? districtAt(districts, place.lon, place.lat) : null;

  const pick = useCallback((at: LngLat) => {
    setPlace({ ...at, title: 'Точка на карте', subtitle: null });
    setResolving(true);
    reverse.current?.abort();
    const controller = new AbortController();
    reverse.current = controller;
    reverseGeocode(at.lon, at.lat, controller.signal)
      .then((found) => found && !controller.signal.aborted && setPlace({ ...found, ...at }))
      .catch(() => {})
      .finally(() => !controller.signal.aborted && setResolving(false));
  }, []);

  const choose = useCallback((found: Place) => {
    reverse.current?.abort();
    setResolving(false);
    setPlace(found);
    map.current?.flyTo(found);
  }, []);

  const locate = () => {
    if (!navigator.geolocation) return setNotice('Браузер не умеет определять местоположение.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const at = { lon: pos.coords.longitude, lat: pos.coords.latitude };
        const [w, s, e, n] = index.bbox;
        if (at.lon < w || at.lon > e || at.lat < s || at.lat > n) {
          return setNotice('Похоже, вы не в Астане — карта пока только про неё.');
        }
        pick(at);
        map.current?.flyTo(at);
      },
      () => {
        setLocating(false);
        setNotice('Не получилось определить местоположение — разрешите доступ к геолокации.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ── Раскладка ──────────────────────────────────────────────────────── */

  const [hover, setHover] = useState<TileHover | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [districtsOpen, setDistrictsOpen] = useState(false);
  const [padding, setPadding] = useState<Padding | null>(null);

  const leftRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  /**
   * Панели лежат поверх карты — город вписываем в оставшуюся часть экрана:
   * на десктопе между колонками, на телефоне между поиском и шторкой.
   * Меряем при загрузке и повороте экрана, а не при каждом изменении
   * содержимого, чтобы карта не прыгала под пальцем.
   */
  useEffect(() => {
    const measure = () => {
      const { innerWidth: w, innerHeight: h } = window;
      if (w >= DESKTOP) {
        const left = leftRef.current?.getBoundingClientRect();
        const aside = asideRef.current?.getBoundingClientRect();
        if (left && aside) setPadding({ top: 0, bottom: 0, left: left.right, right: w - aside.left });
      } else {
        const header = headerRef.current?.getBoundingClientRect();
        const sheet = sheetRef.current?.getBoundingClientRect();
        if (header && sheet) setPadding({ top: header.bottom, bottom: h - sheet.top, left: 0, right: 0 });
      }
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(measure)));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const selectPeriod = (d: Dataset) => setPeriod(periodOf(d));
  const showDistrict = (name: string) => {
    setHighlighted(name);
    map.current?.showDistrict(name);
  };

  const quarters = series.map((d) => quarterLabel(d.year, d.quarter));
  const attribution = `<a href="https://github.com/teamookla/ookla-open-data" target="_blank" rel="noreferrer">Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps</a>. Based on analysis by Ookla of Speedtest Intelligence® data for ${quarters[0]} – ${quarters.at(-1)}. Provided by Ookla and accessed ${index.generatedAt}. Ookla trademarks used under license and reprinted with permission.`;

  const placeCard = place && readings && (
    <PlaceCard
      place={place}
      resolving={resolving}
      district={placeDistrict}
      readings={readings}
      primary={type}
      period={quarterLabel(dataset.year, dataset.quarter)}
      onClose={() => setPlace(null)}
    />
  );

  // На телефоне приближают щипком — кнопки масштаба там только занимают карту.
  const zoomButtons = (
    <>
      <MapButton label="Приблизить" onClick={() => map.current?.zoomIn()}>
        <PlusIcon />
      </MapButton>
      <MapButton label="Отдалить" onClick={() => map.current?.zoomOut()}>
        <MinusIcon />
      </MapButton>
    </>
  );
  const controls = (
    <>
      <MapButton label="Весь город" onClick={() => map.current?.showCity()}>
        <ExpandIcon />
      </MapButton>
      <MapButton label="Где я" onClick={locate} busy={locating}>
        <LocateIcon />
      </MapButton>
      <MapButton label="Откуда данные" onClick={() => setAboutOpen(true)}>
        <HelpIcon />
      </MapButton>
    </>
  );

  return (
    <main
      className="fixed inset-0 overflow-hidden bg-surface-0 text-primary"
      // Кнопка атрибуции MapLibre живёт в правом нижнем углу — поднимаем её над шторкой.
      style={{ '--map-bottom': `${padding?.bottom ?? 0}px` } as React.CSSProperties}
    >
      <MapCanvas
        bbox={index.bbox}
        points={points}
        districts={districts}
        highlightedDistrict={highlighted}
        pin={place}
        padding={padding}
        attribution={attribution}
        onHover={setHover}
        onPick={pick}
        controller={map}
      />

      {/* Левая колонка: на десктопе поиск + сводка, на телефоне только поиск сверху. */}
      <div
        ref={leftRef}
        className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-3 lg:inset-x-auto lg:top-4 lg:left-4 lg:w-[380px]"
      >
        <section ref={headerRef} className="glass pointer-events-auto rounded-2xl p-3 lg:p-4">
          <div className="mb-3 hidden items-baseline justify-between lg:flex">
            <h1 className="text-lg font-semibold tracking-tight">Интернет Астаны</h1>
            <span className="text-xs text-muted">по данным Speedtest®</span>
          </div>
          <SearchBox onSelect={choose} />
          <div className="mt-2.5 flex gap-2">
            <div className="flex-1">
              <Segmented options={TYPE_OPTIONS} value={type} onChange={setType} label="Тип подключения" />
            </div>
            <select
              value={activePeriod}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Квартал"
              className="h-10 rounded-xl bg-white/[0.06] px-2.5 text-sm text-primary outline-none lg:hidden"
            >
              {series.map((d) => (
                <option key={d.id} value={periodOf(d)}>
                  {quarterLabel(d.year, d.quarter)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 hidden lg:block">
            <Timeline series={series} activeId={dataset.id} onSelect={selectPeriod} />
          </div>
        </section>

        <section className="glass pointer-events-auto hidden max-h-[calc(100vh-19rem)] overflow-y-auto rounded-2xl p-4 lg:block">
          {placeCard ?? <CitySummary dataset={dataset} previous={previous} />}
          {failed && <p className="mt-3 text-xs text-secondary">Часть данных не загрузилась — обновите страницу.</p>}
        </section>

        {/* Кнопки карты на телефоне — под поиском, справа. */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 self-end lg:hidden">{controls}</div>
      </div>

      {/* Правая колонка на десктопе: районы. */}
      <aside
        ref={asideRef}
        className="glass pointer-events-auto absolute top-4 right-4 z-10 hidden w-[300px] rounded-2xl p-4 lg:block"
      >
        <div className="mb-2 flex items-baseline justify-between px-2">
          <h2 className="text-sm font-semibold">Районы</h2>
          <span className="text-xs text-muted">
            {NETWORKS[type].short}, Мбит/с
          </span>
        </div>
        <DistrictList dataset={dataset} previous={previous} onHover={setHighlighted} onSelect={showDistrict} />
      </aside>

      {/* Легенда и кнопки на десктопе. */}
      <div className="glass pointer-events-auto absolute bottom-4 left-4 z-10 hidden w-[380px] rounded-2xl px-4 py-3 lg:block">
        <Legend />
      </div>
      <div className="absolute right-4 bottom-12 z-10 hidden flex-col gap-2 lg:flex">
        {zoomButtons}
        {controls}
      </div>

      {/* Шторка на телефоне: место или сводка, легенда, районы по кнопке. */}
      <section
        ref={sheetRef}
        className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-10 max-h-[55vh] overflow-y-auto rounded-2xl p-4 lg:hidden"
      >
        {placeCard ?? <CitySummary dataset={dataset} previous={previous} compact />}
        <div className="mt-4 border-t border-white/[0.08] pt-3">
          <Legend />
        </div>
        <button
          type="button"
          onClick={() => setDistrictsOpen((v) => !v)}
          aria-expanded={districtsOpen}
          className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm"
        >
          <span>Районы</span>
          <span className="text-xs text-muted">{districtsOpen ? 'скрыть' : 'сравнить'}</span>
        </button>
        {districtsOpen && (
          <div className="mt-2">
            <DistrictList dataset={dataset} previous={previous} onHover={setHighlighted} onSelect={showDistrict} />
          </div>
        )}
      </section>

      {hover && <Tooltip hover={hover} />}

      {notice && (
        <div className="glass pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-sm text-primary">
          {notice}
        </div>
      )}

      {aboutOpen && <AboutDialog generatedAt={index.generatedAt} onClose={() => setAboutOpen(false)} />}
    </main>
  );
}

/* ── Подсказка при наведении (только мышь) ─────────────────────────────── */

function Tooltip({ hover }: { hover: TileHover }) {
  const { d, u, l, t, v } = hover.props;
  const tier = tierOf(d);
  const flip = typeof window !== 'undefined' && hover.x > window.innerWidth - 240;

  return (
    <div
      className="glass pointer-events-none absolute z-20 w-52 rounded-xl px-3 py-2.5 text-sm"
      style={{ left: flip ? hover.x - 16 - 208 : hover.x + 16, top: hover.y + 16 }}
      role="status"
    >
      <div className="flex items-center gap-2 text-xs text-secondary">
        <span className="size-2 rounded-full" style={{ background: tier.color }} />
        {tier.label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold text-primary">{mbps(d)}</span>
        <span className="text-xs text-secondary">Мбит/с</span>
      </div>
      <div className="tnum text-xs text-secondary">
        ↑ {mbps(u)} · пинг {l} мс
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {t} {plural(t, ['тест', 'теста', 'тестов'])} · {v} {plural(v, ['устройство', 'устройства', 'устройств'])}
        {' · нажмите для подробностей'}
      </div>
    </div>
  );
}
