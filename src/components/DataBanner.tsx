/**
 * The mock-data disclosure.
 *
 * Shown wherever synthetic figures are on screen. It is deliberately
 * unmissable: the single most dangerous failure mode for this application is an
 * investor mistaking a generated number for their real portfolio.
 */
export function DataBanner({
  containsMockData,
  sourceNotes,
  asOf,
}: {
  containsMockData: boolean;
  sourceNotes: string[];
  asOf: string;
}) {
  if (!containsMockData) {
    return (
      <div className="banner">
        <span className="banner__glyph" aria-hidden="true">
          ●
        </span>
        <div>
          <span className="banner__title">Live data — as of {asOf}</span>
          {sourceNotes.length ? <span>{sourceNotes.join(' ')}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="banner banner--mock" role="note">
      <span className="banner__glyph" aria-hidden="true">
        ▲
      </span>
      <div>
        <span className="banner__title">Mock data — not your brokerage account</span>
        <span>
          Every figure below is generated from seeded fixtures so the calculations can be verified end to end. Snapshot
          date {asOf}.
        </span>
        {sourceNotes.length ? (
          <ul className="bullets" style={{ marginTop: 8 }}>
            {sourceNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
