import { NavLink, useSearchParams } from 'react-router-dom';
import { SemiconductorGrowth } from './SemiconductorGrowth.js';
import { Energy } from './Energy.js';
import { Shipping } from './Shipping.js';
import { Technology } from './Technology.js';
import { GrowthOpportunities } from './GrowthOpportunities.js';

const TABS = [
  { id: 'semiconductors', label: 'Semiconductors' },
  { id: 'energy', label: 'Energy' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'technology', label: 'Technology' },
  { id: 'opportunities', label: 'Opportunities' },
] as const;

type GrowthTab = (typeof TABS)[number]['id'];

function validTab(value: string | null): GrowthTab {
  return TABS.some((tab) => tab.id === value) ? (value as GrowthTab) : 'semiconductors';
}

export function Growth() {
  const [params] = useSearchParams();
  const active = validTab(params.get('tab'));

  return (
    <>
      <div className="section" style={{ marginTop: 0 }}>
        <div className="chip-group" aria-label="Growth areas">
          {TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={`/growth?tab=${tab.id}`}
              className={`chip${active === tab.id ? ' chip--active' : ''}`}
              aria-current={active === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      {active === 'semiconductors' ? <SemiconductorGrowth />
        : active === 'energy' ? <Energy />
          : active === 'shipping' ? <Shipping />
            : active === 'technology' ? <Technology />
              : <GrowthOpportunities />}
    </>
  );
}
