'use client';

import { useRef, useState } from 'react';
import { searchAddress, type Place } from '@/lib/geocode';
import { CloseIcon, SearchIcon, Spinner } from './ui';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; places: Place[] }
  | { kind: 'empty' }
  | { kind: 'error' };

/** Nominatim просит не чаще запроса в секунду. */
const MIN_INTERVAL = 1000;

export function SearchBox({ onSelect }: { onSelect: (place: Place) => void }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const lastRequest = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 3 || Date.now() - lastRequest.current < MIN_INTERVAL) return;

    lastRequest.current = Date.now();
    abort.current?.abort();
    abort.current = new AbortController();
    setState({ kind: 'loading' });

    try {
      const places = await searchAddress(q, abort.current.signal);
      if (places.length === 1) {
        setState({ kind: 'idle' });
        onSelect(places[0]);
      } else {
        setState(places.length ? { kind: 'results', places } : { kind: 'empty' });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setState({ kind: 'error' });
    }
  };

  const pick = (place: Place) => {
    setState({ kind: 'idle' });
    onSelect(place);
  };

  const clear = () => {
    abort.current?.abort();
    setQuery('');
    setState({ kind: 'idle' });
  };

  return (
    <div className="relative">
      <form onSubmit={submit} role="search">
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 ring-1 ring-white/10 transition focus-within:bg-white/[0.1] focus-within:ring-white/30">
          <span className="text-muted">
            <SearchIcon />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setState({ kind: 'idle' })}
            placeholder="Адрес в Астане — и Enter"
            aria-label="Адрес в Астане"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-primary outline-none placeholder:text-muted"
          />
          {state.kind === 'loading' ? (
            <Spinner />
          ) : (
            query && (
              <button type="button" onClick={clear} aria-label="Очистить" className="text-muted hover:text-primary">
                <CloseIcon size={16} />
              </button>
            )
          )}
        </label>
      </form>

      {state.kind === 'results' && (
        <ul className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#1b1b1a] py-1 shadow-2xl" role="listbox">
          {state.places.map((place) => (
            <li key={`${place.lon},${place.lat}`}>
              <button
                type="button"
                onClick={() => pick(place)}
                className="w-full px-3.5 py-2.5 text-left hover:bg-white/[0.07]"
                role="option"
                aria-selected={false}
              >
                <div className="text-sm text-primary">{place.title}</div>
                {place.subtitle && <div className="text-xs text-muted">{place.subtitle}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(state.kind === 'empty' || state.kind === 'error') && (
        <p className="mt-2 px-1 text-xs text-secondary">
          {state.kind === 'empty'
            ? 'Такой адрес в Астане не нашёлся. Попробуйте улицу и номер дома.'
            : 'Поиск адресов сейчас недоступен — можно просто нажать на карту.'}
        </p>
      )}
    </div>
  );
}
