import type { IntelligenceEvent, IntelligenceProviderStatus } from '../../src/intelligence/types.js';

/**
 * OpenBB stays a separate service boundary while the fork is AGPL-licensed.
 * This adapter consumes a DAHCorp-normalized endpoint exposed by an OpenBB
 * deployment; no OpenBB source code is copied into the proprietary app.
 */
export async function fetchOpenBBIntelligence(): Promise<{
  events: IntelligenceEvent[];
  status: IntelligenceProviderStatus;
}> {
  const base = Netlify.env.get('OPENBB_REST_URL')?.trim().replace(/\/$/, '');
  const path = Netlify.env.get('OPENBB_INTELLIGENCE_PATH')?.trim() || '/dahcorp/intelligence';

  if (!base) {
    return {
      events: [],
      status: {
        provider: 'openbb',
        connected: false,
        status: 'not_configured',
        note: 'OpenBB service boundary is ready; configure OPENBB_REST_URL after the isolated OpenBB service is deployed.',
      },
    };
  }

  try {
    const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        events: [],
        status: {
          provider: 'openbb',
          connected: true,
          status: 'partial',
          note: `OpenBB service is configured but the DAHCorp intelligence endpoint returned HTTP ${response.status}.`,
        },
      };
    }
    const payload = (await response.json()) as { events?: IntelligenceEvent[] };
    const events = Array.isArray(payload.events) ? payload.events : [];
    return {
      events,
      status: {
        provider: 'openbb',
        connected: true,
        status: 'live',
        note: `OpenBB REST service connected through the isolated service boundary; ${events.length} normalized events returned.`,
      },
    };
  } catch {
    return {
      events: [],
      status: {
        provider: 'openbb',
        connected: false,
        status: 'unavailable',
        note: 'OpenBB service is configured but currently unreachable. DAHCorp continues with direct providers and primary sources.',
      },
    };
  }
}
