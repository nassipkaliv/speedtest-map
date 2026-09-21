'use client';

import { useEffect } from 'react';
import { CloseIcon } from './ui';

export function AboutDialog({ generatedAt, onClose }: { generatedAt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#1b1b1a] p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 id="about-title" className="text-lg font-semibold">
            Откуда данные
          </h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="text-muted hover:text-primary">
            <CloseIcon />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4 text-sm leading-relaxed text-secondary">
          <p>
            <span className="text-primary">Speedtest® by Ookla®.</span> Когда человек запускает Speedtest в
            приложении на Android или iOS, приложение запоминает скорость и точное место. Ookla раз в квартал
            усредняет такие тесты по квадратам ≈ 610 × 385 м и бесплатно публикует. Тесты с сайта и
            ноутбуков сюда не попадают.
          </p>
          <p>
            <span className="text-primary">Wi-Fi и сотовая.</span> «Wi-Fi» — телефон был подключён к Wi-Fi:
            дома, в кафе, в офисе. Это не скорость тарифа — роутер и стены её обычно срезают. «Сотовая» —
            телефон в сети оператора, 4G или 5G.
          </p>
          <p>
            <span className="text-primary">Точка на карте</span> — один квадрат. Цвет — средняя загрузка,
            размер — сколько устройств там мерило. Пустое место значит, что там никто не запускал тест, а не
            что интернета нет.
          </p>
          <p>
            <span className="text-primary">Районы</span> усреднены с весом по устройствам, а не по тестам:
            иначе один телефон с тысячей автоматических замеров перевешивает целый район.
          </p>
          <p className="text-muted">
            Данные Ookla — CC BY-NC-SA 4.0, только некоммерческое использование. Карта — OpenFreeMap,
            © OpenMapTiles, © участники OpenStreetMap. Поиск адресов — Nominatim. Выгрузка от{' '}
            <span className="whitespace-nowrap">{new Date(generatedAt).toLocaleDateString('ru-RU')}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
