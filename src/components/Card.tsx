import type { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'intel' | 'risk';

const TONE_CLASS: Record<Tone, string> = {
  default: '',
  accent: 'card--accent',
  intel: 'card--intel',
  risk: 'card--risk',
};

export function Card({
  label,
  title,
  action,
  tone = 'default',
  tight = false,
  hint,
  children,
}: {
  label?: string;
  title?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  tight?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`card ${TONE_CLASS[tone]} ${tight ? 'card--tight' : ''}`.trim()}>
      {label ? <p className="card__label">{label}</p> : null}
      {title || action ? (
        <div className="card__title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      ) : null}
      {children}
      {hint ? <p className="card__hint">{hint}</p> : null}
    </section>
  );
}
