import { delta, mbps, type Dataset, type Summary } from '@/lib/tiles';

/** Районы по убыванию загрузки. Полоски от нуля — разница между районами видна честно, без растяжки. */
export function DistrictList({
  dataset,
  previous,
  onHover,
  onSelect,
}: {
  dataset: Dataset;
  previous: Dataset | null;
  onHover: (name: string | null) => void;
  onSelect: (name: string) => void;
}) {
  const rows = Object.entries(dataset.districts)
    .filter((e): e is [string, Summary] => e[1] != null)
    .sort((a, b) => b[1].download - a[1].download);
  const max = Math.max(...rows.map(([, s]) => s.download));

  return (
    <ol className="flex flex-col gap-1">
      {rows.map(([name, s]) => {
        const before = previous?.districts[name];
        const change = before ? delta(s.download, before.download) : null;
        return (
          <li key={name}>
            <button
              type="button"
              onClick={() => onSelect(name)}
              onMouseEnter={() => onHover(name)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(name)}
              onBlur={() => onHover(null)}
              className="group w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
              title={`↑ ${mbps(s.upload)} Мбит/с · пинг ${s.latency} мс`}
            >
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-primary">{name}</span>
                <span className="tnum">
                  <span className="text-primary">{mbps(s.download)}</span>
                  {change && <span className="ml-1.5 text-[11px] text-muted">{change.text}</span>}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-white/30 transition-colors group-hover:bg-white/70"
                  style={{ width: `${(s.download / max) * 100}%` }}
                />
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
