'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { boundsOf, districtLabels, tierColorExpression, type TileProps } from '@/lib/tiles';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const SURFACE = '#0c0c0c';

/** Плотно застроенная Астана — её вписываем в свободную от панелей часть экрана. */
const CITY_CORE: [[number, number], [number, number]] = [[71.36, 51.075], [71.53, 51.195]];

export type TileHover = { x: number; y: number; props: TileProps };
export type Padding = { top: number; right: number; bottom: number; left: number };
export type LngLat = { lon: number; lat: number };

export type MapController = {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (at: LngLat) => void;
  showDistrict: (name: string) => void;
  showCity: () => void;
};

type Props = {
  bbox: [number, number, number, number];
  points: FeatureCollection | null;
  districts: FeatureCollection | null;
  highlightedDistrict: string | null;
  pin: LngLat | null;
  padding: Padding | null;
  attribution: string;
  onHover: (hover: TileHover | null) => void;
  onPick: (at: LngLat) => void;
  controller: Ref<MapController>;
};

/**
 * Размеры в долях клетки. MapLibre считает мир тайлами по 512 px, поэтому
 * квадрат Ookla (z16) занимает 512 px на зуме 16 и вдвое меньше на каждом
 * шаге вниз. Точка — около четверти ширины клетки: сетка читается, точки не
 * слипаются. Умножаем на «уверенность» — квадрат с одним устройством мельче.
 */
const cellRadius = (fraction: number, value: unknown = 1) => [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  10,
  ['*', 8 * fraction, value],
  16,
  ['*', 512 * fraction, value],
];
const confidence = ['interpolate', ['linear'], ['get', 'v'], 1, 0.6, 3, 0.75, 10, 0.9, 30, 1];
const dotRadius = cellRadius(0.23, confidence);
const glowRadius = cellRadius(0.62, confidence);
/** Невидимая зона наведения — на всю клетку, чтобы не целиться в маленькую точку. */
const hitRadius = cellRadius(0.5);

/**
 * Тонкая обёртка над MapLibre. Пакет импортируется только в браузере —
 * он трогает window и WebGL при загрузке модуля.
 */
export function MapCanvas({
  bbox,
  points,
  districts,
  highlightedDistrict,
  pin,
  padding,
  attribution,
  onHover,
  onPick,
  controller,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pinEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

  // Последние значения пропсов — для обработчиков, созданных один раз при загрузке карты.
  const latest = useRef({ points, districts, highlightedDistrict, pin, padding, onHover, onPick });
  useLayoutEffect(() => {
    latest.current = { points, districts, highlightedDistrict, pin, padding, onHover, onPick };
  });

  useImperativeHandle(controller, () => {
    const pad = () => inset(latest.current.padding, 24);
    return {
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
      flyTo: ({ lon, lat }) =>
        mapRef.current?.flyTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 14), padding: pad() }),
      showDistrict: (name) => {
        const feature = latest.current.districts?.features.find((f) => f.properties?.name === name);
        if (feature) mapRef.current?.fitBounds(boundsOf(feature.geometry), { padding: pad(), duration: 700 });
      },
      showCity: () => mapRef.current?.fitBounds(CITY_CORE, { padding: pad(), duration: 700 }),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let hovered: number | string | undefined;

    (async () => {
      const { Map, setWorkerUrl } = await import('maplibre-gl');
      if (cancelled || !container.current) return;

      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      const [w, s, e, n] = bbox;
      const map = new Map({
        container: container.current,
        style: STYLE,
        bounds: CITY_CORE,
        fitBoundsOptions: { padding: inset(latest.current.padding, 24) },
        maxBounds: [[w - 0.4, s - 0.25], [e + 0.4, n + 0.25]],
        minZoom: 9.5,
        maxZoom: 16.5,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true, customAttribution: attribution },
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;
        const layers = map.getStyle().layers;

        // Подписи только по-русски: в OSM у Астаны казахские и латинские
        // названия, и стиль по умолчанию рисует их парами друг под другом.
        for (const layer of layers) {
          if (layer.type === 'symbol' && layer.layout?.['text-field']) {
            map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ru'], ['get', 'name']]);
          }
        }

        // Точки — поверх дорог, но под названиями улиц и мест.
        const beforeLabels =
          layers.find((l) => l.type === 'symbol' && /^(highway_name|place)/.test(l.id))?.id ??
          layers.find((l) => l.type === 'symbol')?.id;

        map.addSource('tiles', { type: 'geojson', data: latest.current.points ?? emptyCollection });
        map.addLayer(
          {
            id: 'tiles-glow',
            type: 'circle',
            source: 'tiles',
            paint: {
              'circle-radius': glowRadius as never,
              'circle-color': tierColorExpression as never,
              'circle-blur': 1,
              'circle-opacity': 0.24,
            },
          },
          beforeLabels
        );
        map.addLayer(
          {
            id: 'tiles-dot',
            type: 'circle',
            source: 'tiles',
            paint: {
              'circle-radius': dotRadius as never,
              'circle-color': tierColorExpression as never,
              'circle-opacity': 0.95,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
            },
          },
          beforeLabels
        );
        map.addLayer(
          {
            id: 'tiles-hit',
            type: 'circle',
            source: 'tiles',
            // Прозрачный цвет, а не circle-opacity: 0 — слой с нулевой
            // непрозрачностью MapLibre не отдаёт в queryRenderedFeatures.
            paint: { 'circle-radius': hitRadius as never, 'circle-color': 'rgba(0,0,0,0)' },
          },
          beforeLabels
        );

        map.addSource('districts', { type: 'geojson', data: latest.current.districts ?? emptyCollection });
        map.addSource('district-labels', {
          type: 'geojson',
          data: latest.current.districts ? districtLabels(latest.current.districts) : emptyCollection,
        });
        map.addLayer({
          id: 'districts-line',
          type: 'line',
          source: 'districts',
          paint: { 'line-color': 'rgba(255,255,255,0.22)', 'line-width': 1, 'line-dasharray': [3, 2] },
        });
        map.addLayer({
          id: 'districts-highlight',
          type: 'line',
          source: 'districts',
          filter: ['==', ['get', 'name'], ''],
          paint: { 'line-color': '#ffffff', 'line-width': 2 },
        });
        map.addLayer({
          id: 'district-labels',
          type: 'symbol',
          source: 'district-labels',
          layout: {
            'text-field': ['upcase', ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-letter-spacing': 0.2,
          },
          paint: { 'text-color': 'rgba(255,255,255,0.75)', 'text-halo-color': SURFACE, 'text-halo-width': 1.5 },
        });

        ready.current = true;
        applyHighlight(map, latest.current.highlightedDistrict);

        // Полная атрибуция длинная — сворачиваем в кнопку ⓘ.
        const attrib = container.current?.querySelector('.maplibregl-ctrl-attrib');
        attrib?.classList.remove('maplibregl-compact-show');
        attrib?.removeAttribute('open');
      });

      const setHovered = (id: number | string | undefined) => {
        if (hovered === id) return;
        if (hovered !== undefined) map.setFeatureState({ source: 'tiles', id: hovered }, { hover: false });
        hovered = id;
        if (id !== undefined) map.setFeatureState({ source: 'tiles', id }, { hover: true });
      };

      map.on('mousemove', 'tiles-hit', (ev) => {
        const feature = ev.features?.[0];
        if (!feature) return;
        map.getCanvas().style.cursor = 'pointer';
        setHovered(feature.id);
        latest.current.onHover({ x: ev.point.x, y: ev.point.y, props: feature.properties as TileProps });
      });
      map.on('mouseleave', 'tiles-hit', () => {
        map.getCanvas().style.cursor = '';
        setHovered(undefined);
        latest.current.onHover(null);
      });
      map.on('dragstart', () => latest.current.onHover(null));

      // Клик по любому месту — отчёт по этому месту. По точке — ставим метку в её центр.
      map.on('click', (ev) => {
        const [feature] = map.queryRenderedFeatures(ev.point, { layers: ['tiles-hit'] });
        const [lon, lat] =
          feature?.geometry.type === 'Point'
            ? (feature.geometry.coordinates as [number, number])
            : [ev.lngLat.lng, ev.lngLat.lat];
        latest.current.onHover(null);
        latest.current.onPick({ lon, lat });
      });

      // Метка выбранного места — DOM-элемент с пульсацией, двигаем вместе с картой.
      const placePin = () => {
        const at = latest.current.pin;
        const el = pinEl.current;
        if (!el) return;
        if (!at) {
          el.style.display = 'none';
          return;
        }
        const p = map.project([at.lon, at.lat]);
        el.style.display = 'block';
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      };
      map.on('move', placePin);
      map.on('load', placePin);
    })();

    return () => {
      cancelled = true;
      ready.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Карта создаётся один раз; изменения данных приходят через эффекты ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !points) return;
    (map.getSource('tiles') as GeoJSONSource | undefined)?.setData(points);
    onHover(null);
  }, [points, onHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !districts) return;
    (map.getSource('districts') as GeoJSONSource | undefined)?.setData(districts);
    (map.getSource('district-labels') as GeoJSONSource | undefined)?.setData(districtLabels(districts));
  }, [districts]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready.current) applyHighlight(map, highlightedDistrict);
  }, [highlightedDistrict]);

  useEffect(() => {
    const map = mapRef.current;
    const el = pinEl.current;
    if (!map || !el) return;
    if (!pin) {
      el.style.display = 'none';
      return;
    }
    const p = map.project([pin.lon, pin.lat]);
    el.style.display = 'block';
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }, [pin]);

  // Панели меряются уже после создания карты — перевписываем город под них.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !padding) return;
    map.fitBounds(CITY_CORE, { padding: inset(padding, 24), duration: 0 });
  }, [padding]);

  // MapLibre вешает на контейнер position: relative из своего CSS (вне слоёв,
  // поэтому он сильнее утилит Tailwind) — позиционируем обёртку, а не его.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Карта скорости интернета в Астане" />
      <div ref={pinEl} className="map-pin" style={{ display: 'none' }} aria-hidden>
        <span className="map-pin__pulse" />
        <span className="map-pin__dot" />
      </div>
    </div>
  );
}

const emptyCollection: FeatureCollection = { type: 'FeatureCollection', features: [] };

const inset = (p: Padding | null, extra: number): Padding => ({
  top: (p?.top ?? 0) + extra,
  right: (p?.right ?? 0) + extra,
  bottom: (p?.bottom ?? 0) + extra,
  left: (p?.left ?? 0) + extra,
});

function applyHighlight(map: MapLibreMap, name: string | null) {
  map.setFilter('districts-highlight', ['==', ['get', 'name'], name ?? '']);
}
