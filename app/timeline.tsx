import { mbps, quarterLabel, type Dataset } from '@/lib/tiles';

/** Выбор квартала с мини-графиком средней скорости по городу — сразу видно, куда всё идёт. */
export function Timeline({
  series,
  activeId,
  onSelect,
}: {
  series: Dataset[];
  activeId: string;
  onSelect: (d: Dataset) => void;
}) {
  const max = Math.max(...series.map((d) => d.city.download));

  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }} role="group" aria-label="Квартал">
      {series.map((d) => {
        const active = d.id === activeId;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={active}
            aria-label={`${quarterLabel(d.year, d.quarter)}: ${mbps(d.city.download)} Мбит/с`}
            className={`flex flex-col items-center rounded-lg px-1 pt-2 pb-1.5 transition-colors ${
              active ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
            }`}
          >
            <span className={`tnum text-[11px] ${active ? 'text-primary' : 'text-muted'}`}>{mbps(d.city.download)}</span>
            <span className="mt-1 flex h-7 w-full items-end justify-center">
              <span
                className={`w-3 rounded-t-sm ${active ? 'bg-white' : 'bg-white/25'}`}
                style={{ height: `${Math.max(18, (d.city.download / max) * 100)}%` }}
              />
            </span>
            <span className={`mt-1 text-[11px] whitespace-nowrap ${active ? 'text-primary' : 'text-secondary'}`}>
              {['I', 'II', 'III', 'IV'][d.quarter - 1]} кв. {String(d.year).slice(2)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
