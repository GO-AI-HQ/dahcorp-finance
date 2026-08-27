import type { ReactNode } from 'react';

export function PageHead({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-head">
      <p className="page-head__eyebrow">{eyebrow}</p>
      <div className="row row--between">
        <h1>{title}</h1>
        {action}
      </div>
      {lede ? <p className="page-head__lede">{lede}</p> : null}
    </header>
  );
}
