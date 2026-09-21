import { TIERS } from '@/lib/tiles';

/** Шкала сплошной лентой: пять отрезков читаются как одна ось «медленно → быстро». */
export function Legend() {
  return (
    <figure className="m-0">
      <div className="grid grid-cols-5 gap-1">
        {TIERS.map((t) => (
          <div key={t.range} className="min-w-0">
            <div className="h-1.5 rounded-full" style={{ background: t.color }} />
            <div className="mt-1.5 text-[11px] leading-tight text-secondary">{t.label}</div>
            <div className="tnum text-[11px] text-muted">{t.range}</div>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[11px] text-muted">
        Загрузка, Мбит/с. Мелкая точка — там мерило мало устройств.
      </figcaption>
    </figure>
  );
}
