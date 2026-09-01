'use client';

import { useRef, useState } from 'react';
import { years1 } from '@/lib/calc';

type Point = { year: number; value: number };

const W = 760;
const H = 300;
const PAD = { top: 20, right: 60, bottom: 34, left: 46 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Шаг и верхняя граница шкалы такие, чтобы подписи оси были целыми. */
function niceScale(max: number): { top: number; step: number } {
  const step = [0.5, 1, 2, 5, 10, 20, 25, 50].find((s) => max / s <= 5) ?? 100;
  return { top: Math.ceil(max / step) * step, step };
}

export function TrendChart({
  points,
  markers,
  label,
}: {
  points: Point[];
  markers: number[];
  label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) return null;

  const firstYear = points[0].year;
  const lastYear = points[points.length - 1].year;
  const { top, step } = niceScale(Math.max(...points.map((p) => p.value)));

  const x = (year: number) =>
    PAD.left + ((year - firstYear) / (lastYear - firstYear)) * PLOT_W;
  const y = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.year)} ${y(p.value)}`).join(' ');

  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const yearTicks = points
    .map((p) => p.year)
    .filter((year) => year % 5 === 0 || year === lastYear);

  const active = hover == null ? null : points[hover];

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const year = firstYear + ((px - PAD.left) / PLOT_W) * (lastYear - firstYear);
    let nearest = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.year - year) < Math.abs(points[nearest].year - year)) nearest = i;
    });
    setHover(nearest);
  };

  return (
    <figure className="relative m-0">
      <figcaption className="mb-3 text-sm text-secondary">{label}</figcaption>

      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={label}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize={12}
              fill="var(--text-muted)"
              className="tnum"
            >
              {tick}
            </text>
          </g>
        ))}

        {yearTicks.map((year) => (
          <text
            key={year}
            x={x(year)}
            y={H - 10}
            textAnchor="middle"
            fontSize={12}
            fill="var(--text-muted)"
            className="tnum"
          >
            {year}
          </text>
        ))}

        {/* Годы, которые сравниваются в карточках выше. */}
        {markers.map((year) => (
          <line
            key={year}
            x1={x(year)}
            x2={x(year)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}

        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />

        {markers.map((year) => {
          const point = points.find((p) => p.year === year);
          if (!point) return null;
          return (
            <circle
              key={year}
              cx={x(point.year)}
              cy={y(point.value)}
              r={5}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          );
        })}

        {active && (
          <>
            <line
              x1={x(active.year)}
              x2={x(active.year)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="var(--text-secondary)"
              strokeWidth={1}
            />
            <circle
              cx={x(active.year)}
              cy={y(active.value)}
              r={6}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </>
        )}

        {/* Прямая подпись последнего значения — вместо чисел на каждой точке. */}
        <text
          x={x(lastYear) + 12}
          y={y(points[points.length - 1].value) + 4}
          fontSize={13}
          fill="var(--text-primary)"
          className="tnum"
        >
          {years1(points[points.length - 1].value)}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-8 -translate-x-1/2 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm shadow-sm"
          style={{ left: `${(x(active.year) / W) * 100}%` }}
        >
          <div className="tnum text-muted">{active.year}</div>
          <div className="tnum font-medium">{years1(active.value)} года</div>
        </div>
      )}
    </figure>
  );
}
