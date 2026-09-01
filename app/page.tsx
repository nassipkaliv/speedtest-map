import { buildDataset } from '@/lib/data';
import { Calculator } from './calculator';

export default function Home() {
  const dataset = buildDataset();
  const [first, last] = [dataset.years[0], dataset.years[dataset.years.length - 1]];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Сколько стоит стать взрослым
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-secondary">
          Сколько лет нужно работать на собственную квартиру в казахстанском городе — сейчас
          и поколение назад. Официальные ряды Бюро национальной статистики, {first}–{last}.
        </p>
      </header>

      <Calculator dataset={dataset} />

      <footer className="mt-16 border-t border-border pt-6 text-sm text-muted">
        <p>
          Источник данных — Бюро национальной статистики АСПиР РК, динамические ряды.
          Актуальность выгрузки: {dataset.fetchedAt}.
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {dataset.sources.map((source) => (
            <li key={source.label}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-secondary"
              >
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
