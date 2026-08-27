export type BadgeTone = 'neutral' | 'gold' | 'ice' | 'positive' | 'negative' | 'warning' | 'intel' | 'risk';

const CLASS: Record<BadgeTone, string> = {
  neutral: '',
  gold: 'badge--gold',
  ice: 'badge--ice',
  positive: 'badge--positive',
  negative: 'badge--negative',
  warning: 'badge--warning',
  intel: 'badge--intel',
  risk: 'badge--risk',
};

/**
 * A status chip. `glyph` is required for any non-neutral tone so status is never
 * carried by colour alone — the shape and the label both say what it means.
 */
export function Badge({
  children,
  tone = 'neutral',
  glyph,
  title,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  glyph?: string;
  title?: string;
}) {
  return (
    <span className={`badge ${CLASS[tone]}`.trim()} title={title}>
      {glyph ? (
        <span className="badge__glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}
