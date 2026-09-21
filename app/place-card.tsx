import type { Place } from '@/lib/geocode';
import { NETWORKS, count, mbps, plural, tierOf, type NetworkType, type PlaceReading } from '@/lib/tiles';
import { CloseIcon, Spinner } from './ui';

export type Readings = Record<NetworkType, PlaceReading | null | undefined>;

export function PlaceCard({
  place,
  resolving,
  district,
  readings,
  primary,
  period,
  onClose,
}: {
  place: Place;
  resolving: boolean;
  district: string | null;
  readings: Readings;
  primary: NetworkType;
  period: string;
  onClose: () => void;
}) {
  const order: NetworkType[] = primary === 'fixed' ? ['fixed', 'mobile'] : ['mobile', 'fixed'];

  return (
    <section aria-label="Скорость в выбранном месте">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-primary">
            {resolving ? <span className="text-secondary">Определяю адрес…</span> : place.title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted">{caption(place, district, period)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="-m-1 rounded-lg p-1 text-muted hover:bg-white/[0.06] hover:text-primary"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="mt-4 flex flex-col gap-3">
        {order.map((type) => (
          <Reading key={type} type={type} reading={readings[type]} />
        ))}
      </div>
    </section>
  );
}

function Reading({ type, reading }: { type: NetworkType; reading: PlaceReading | null | undefined }) {
  const name = NETWORKS[type].label;

  if (reading === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] p-3.5 text-sm text-muted">
        <Spinner /> {name}
      </div>
    );
  }
  if (reading === null) {
    return (
      <div className="rounded-xl bg-white/[0.04] p-3.5">
        <div className="text-xs font-medium tracking-wide text-muted uppercase">{name}</div>
        <p className="mt-1.5 text-sm text-secondary">
          Рядом за квартал никто не запускал Speedtest — данных нет.
        </p>
      </div>
    );
  }

  const tier = tierOf(reading.download);
  const faster = Math.round(reading.fasterThan * 100);

  return (
    <div className="rounded-xl bg-white/[0.04] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">{name}</span>
        <span className="flex items-center gap-1.5 text-xs text-secondary">
          <span className="size-2 rounded-full" style={{ background: tier.color }} />
          {tier.label}
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl leading-none font-semibold text-primary">{mbps(reading.download)}</span>
          <span className="text-sm text-secondary">Мбит/с</span>
        </div>
        <span className="tnum text-sm text-secondary">
          ↑ {mbps(reading.upload)} · {Math.round(reading.latency)} мс
        </span>
      </div>

      {/* Где это место среди всех квадратов города. */}
      <div className="mt-3">
        <div className="relative h-1 rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${faster}%` }} />
          <div
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-surface-1"
            style={{ left: `${faster}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-secondary">{standing(faster)}</p>
      </div>

      <p className="mt-1 text-[11px] text-muted">
        {reading.basis === 'tile' ? 'По этому кварталу' : 'Своих тестов мало — по соседним кварталам'}:{' '}
        {count(reading.tests)} {plural(reading.tests, ['тест', 'теста', 'тестов'])} с {count(reading.devices)}{' '}
        {plural(reading.devices, ['устройства', 'устройств', 'устройств'])}
      </p>
    </div>
  );
}

/**
 * Подпись под адресом: геокодер часто сам возвращает район, а для кликов
 * по пустому месту — только район. Не повторяем то, что уже написано.
 */
function caption(place: Place, district: string | null, period: string) {
  const parts: string[] = [];
  const seen = place.title.toLowerCase();
  if (place.subtitle && !seen.includes(place.subtitle.toLowerCase())) parts.push(place.subtitle);
  if (district && !parts.concat(place.title).some((p) => p.toLowerCase().includes(district.toLowerCase()))) {
    parts.push(`район ${district}`);
  }
  parts.push(period);
  return parts.join(' · ');
}

function standing(faster: number) {
  if (faster <= 2) return 'Одно из самых медленных мест города';
  if (faster >= 98) return 'Одно из самых быстрых мест города';
  return faster >= 50 ? (
    <>
      Быстрее, чем в <span className="text-primary">{faster}%</span> мест города
    </>
  ) : (
    <>
      Медленнее, чем в <span className="text-primary">{100 - faster}%</span> мест города
    </>
  );
}
