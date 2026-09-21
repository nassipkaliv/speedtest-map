import { NETWORKS, delta, mbps, type Dataset, type Summary } from '@/lib/tiles';

export function CitySummary({
  dataset,
  previous,
  compact = false,
}: {
  dataset: Dataset;
  previous: Dataset | null;
  compact?: boolean;
}) {
  const city = dataset.city;
  const change = previous ? delta(city.download, previous.city.download) : null;
  const ranked = Object.entries(dataset.districts)
    .filter((e): e is [string, Summary] => e[1] != null)
    .sort((a, b) => b[1].download - a[1].download);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return (
    <section aria-label="Скорость по городу">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        В среднем по городу · {NETWORKS[dataset.type].short}
      </p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span
            className={`leading-none font-semibold tracking-tight text-primary ${compact ? 'text-4xl' : 'text-5xl'}`}
          >
            {mbps(city.download)}
          </span>
          <span className="text-base text-secondary">Мбит/с</span>
        </div>
        {change && (
          <span className="mb-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-xs whitespace-nowrap text-secondary">
            {change.pct >= 0 ? '▲' : '▼'} {change.text} за квартал
          </span>
        )}
      </div>
      <p className="tnum mt-2 text-sm text-secondary">
        ↑ {mbps(city.upload)} Мбит/с · пинг {city.latency} мс
      </p>

      {!compact && best && worst && best !== worst && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <dt className="text-xs text-muted">Быстрее всего</dt>
            <dd className="mt-1 text-primary">
              {best[0]} <span className="tnum text-secondary">{mbps(best[1].download)}</span>
            </dd>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <dt className="text-xs text-muted">Медленнее всего</dt>
            <dd className="mt-1 text-primary">
              {worst[0]} <span className="tnum text-secondary">{mbps(worst[1].download)}</span>
            </dd>
          </div>
        </dl>
      )}

      <p className={`text-sm text-muted ${compact ? 'mt-3' : 'mt-4'}`}>
        {compact
          ? 'Нажмите на карту или найдите адрес.'
          : 'Найдите свой адрес или нажмите на любое место карты — покажу скорость Wi-Fi и сотовой именно там.'}
      </p>
    </section>
  );
}
