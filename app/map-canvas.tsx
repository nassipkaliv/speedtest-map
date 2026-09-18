'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { boundsOf, districtLabels, tierColorExpression, type TileProps } from '@/lib/tiles';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const SURFACE = '#0c0c0c';

export type TileHover = { x: number; y: number; props: TileProps };
export type Padding = { top: number; right: number; bottom: number; left: number };

/** Плотно застроенная Астана — её и вписываем в свободную от панелей часть экрана. */
const CITY_CORE: [[number, number], [number, number]] = [[71.33, 51.06], [71.55, 51.21]];

type Props = {
  bbox: [number, number, number, number];
  tiles: FeatureCollection | null;
  districts: FeatureCollection | null;
  highlightedDistrict: string | null;
  focus: { name: string; nonce: number } | null;
  attribution: string;
  padding: Padding | null;
  onHover: (hover: TileHover | null) => void;
};

/**
 * Тонкая обёртка над MapLibre. Сам пакет импортируется только в браузере —
 * он трогает window и WebGL при загрузке модуля.
 */
export function MapCanvas({
  bbox,
  tiles,
  districts,
  highlightedDistrict,
  focus,
  attribution,
  padding,
  onHover,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

  // Последние значения пропсов — чтобы применить их, когда карта догрузится.
  const latest = useRef({ tiles, districts, highlightedDistrict, padding, onHover });
  useLayoutEffect(() => {
    latest.current = { tiles, districts, highlightedDistrict, padding, onHover };
  });

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
        fitBoundsOptions: { padding: latest.current.padding ?? 20 },
        maxBounds: [[w - 0.4, s - 0.25], [e + 0.4, n + 0.25]],
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true, customAttribution: attribution },
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;

        // Квадраты — поверх дорог (иначе тёмные линии режут их на куски),
        // но под названиями улиц и мест, чтобы было понятно, где ты.
        const layers = map.getStyle().layers;
        const firstLabel =
          layers.find((l) => l.type === 'symbol' && /^(highway_name|place)/.test(l.id))?.id ??
          layers.find((l) => l.type === 'symbol')?.id;

        map.addSource('tiles', { type: 'geojson', data: latest.current.tiles ?? emptyCollection });
        map.addLayer(
          {
            id: 'tiles-fill',
            type: 'fill',
            source: 'tiles',
            paint: {
              'fill-color': tierColorExpression as never,
              'fill-opacity': 0.9,
            },
          },
          firstLabel
        );
        // Зазор цвета фона между соседними квадратами.
        map.addLayer(
          {
            id: 'tiles-gap',
            type: 'line',
            source: 'tiles',
            paint: { 'line-color': SURFACE, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 1.5] },
          },
          firstLabel
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
          paint: { 'line-color': 'rgba(255,255,255,0.35)', 'line-width': 1 },
        });
        map.addLayer({
          id: 'districts-highlight',
          type: 'line',
          source: 'districts',
          filter: ['==', ['get', 'name'], ''],
          paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
        });
        map.addLayer({
          id: 'district-labels',
          type: 'symbol',
          source: 'district-labels',
          layout: {
            'text-field': ['upcase', ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-letter-spacing': 0.12,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': SURFACE, 'text-halo-width': 1.5 },
        });
        map.addLayer({
          id: 'tiles-hover',
          type: 'line',
          source: 'tiles',
          paint: {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
          },
        });

        ready.current = true;
        applyHighlight(map, latest.current.highlightedDistrict);

        // Полная атрибуция длинная и на телефоне закрывает полэкрана —
        // сворачиваем в кнопку ⓘ, короткая версия есть в панели.
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

      const show = (ev: { point: { x: number; y: number }; features?: { id?: number | string; properties: unknown }[] }) => {
        const feature = ev.features?.[0];
        if (!feature) return;
        setHovered(feature.id);
        latest.current.onHover({ x: ev.point.x, y: ev.point.y, props: feature.properties as TileProps });
      };

      map.on('mousemove', 'tiles-fill', (ev) => {
        map.getCanvas().style.cursor = 'crosshair';
        show(ev);
      });
      map.on('mouseleave', 'tiles-fill', () => {
        map.getCanvas().style.cursor = '';
        setHovered(undefined);
        latest.current.onHover(null);
      });
      // На телефоне наведения нет — показываем по тапу, а тап мимо квадратов прячет подсказку.
      map.on('click', (ev) => {
        const [feature] = map.queryRenderedFeatures(ev.point, { layers: ['tiles-fill'] });
        if (feature) return show({ point: ev.point, features: [feature] });
        setHovered(undefined);
        latest.current.onHover(null);
      });
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
    if (!map || !ready.current || !tiles) return;
    (map.getSource('tiles') as GeoJSONSource | undefined)?.setData(tiles);
    onHover(null);
  }, [tiles, onHover]);

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
    if (!map || !focus || !districts) return;
    const feature = districts.features.find((f) => f.properties?.name === focus.name);
    if (feature) map.fitBounds(boundsOf(feature.geometry), { padding: inset(padding, 40), duration: 700 });
  }, [focus, districts, padding]);

  // Панели меряются уже после создания карты — перевписываем город под них.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !padding) return;
    map.fitBounds(CITY_CORE, { padding: inset(padding, 20), duration: 0 });
  }, [padding]);

  // MapLibre вешает на контейнер position: relative из своего CSS (вне слоёв,
  // поэтому он сильнее утилит Tailwind) — позиционируем обёртку, а не его.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Карта скорости интернета в Астане" />
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
