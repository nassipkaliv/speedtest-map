import type { ReactNode } from 'react';

/* ── Иконки: 20×20, линия 1.6, цвет от текста ─────────────────────────── */

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const SearchIcon = () => (
  <Icon>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.3 3.3" />
  </Icon>
);

export const LocateIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M4.5 10h11" />
  </Icon>
);

/** «?» а не «i» — рядом в углу карты уже есть ⓘ атрибуции MapLibre. */
export const HelpIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" />
    <path d="M7.9 8a2.2 2.2 0 0 1 4.2.8c0 1.5-2.1 1.9-2.1 3.2M10 14.3v.01" />
  </Icon>
);

export const CloseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const ExpandIcon = () => (
  <Icon>
    <path d="M3.5 7.5V3.5h4M16.5 7.5V3.5h-4M3.5 12.5v4h4M16.5 12.5v4h-4" />
  </Icon>
);

export function Spinner() {
  return (
    <span
      className="inline-block size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
      aria-hidden
    />
  );
}

/* ── Переключатель ─────────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex rounded-xl bg-white/[0.06] p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`h-8 flex-1 rounded-lg text-sm transition-all ${
            value === o.value
              ? 'bg-white/[0.14] font-medium text-primary shadow-sm'
              : 'text-secondary hover:text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MapButton({
  label,
  onClick,
  children,
  busy = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="glass flex size-10 items-center justify-center rounded-xl text-secondary transition-colors hover:text-primary"
    >
      {busy ? <Spinner /> : children}
    </button>
  );
}
