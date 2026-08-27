import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession, verifySession } from '../lib/session.mts';
import { loadStrategyConfig, recordAudit, saveStrategyConfig } from '../lib/store.mts';
import { DEFAULT_STRATEGY_CONFIG, MILESTONES, STRATEGY_LEVELS } from '../../src/core/config.js';
import type { StrategyConfig } from '../../src/core/config.js';
import { databaseAvailable } from '../lib/store.mts';
import { parseCalculationScope } from '../../src/core/scope.js';

/**
 * GET  /.netlify/functions/settings — read the strategy configuration.
 * PUT  /.netlify/functions/settings — update it.
 *
 * This is the only way any policy threshold changes. The risk engine reads the
 * stored config and nothing else, so this endpoint is the human override
 * mechanism — which is why it is authenticated, validated field-by-field, and
 * audited on every write.
 */

/** Numeric fields, with the bounds each is allowed to take. */
const NUMERIC_BOUNDS: Partial<Record<keyof StrategyConfig, [number, number]>> = {
  externalLiquidityTarget: [0, 10_000_000],
  externalLiquidityCurrent: [0, 10_000_000],
  brokerCashFloor: [0, 100_000],
  conservativeHaircut: [0, 0.9],
  dripRate: [0, 1],
  monthlyContribution: [0, 1_000_000],
  bifurcationReinvestShare: [0, 1],
  maxLeveragedSleevePct: [0, 0.5],
  maxSinglePositionPct: [0.05, 1],
  maxSingleExposurePct: [0.05, 1],
  maxOrderNotional: [1, 1_000_000],
};

const BASES = new Set(['latest', 'avg4w', 'avg13w', 'avg26w', 'avg52w']);
const DIP_REFERENCES = new Set(['recent_high_60d', 'high_52w', 'sma50', 'sma200', 'fair_value']);

function sanitise(input: Record<string, unknown>): { patch: Partial<StrategyConfig>; rejected: string[] } {
  const patch: Partial<StrategyConfig> = {};
  const rejected: string[] = [];

  for (const [key, bounds] of Object.entries(NUMERIC_BOUNDS) as [keyof StrategyConfig, [number, number]][]) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) {
      rejected.push(`${key} must be a number between ${bounds[0]} and ${bounds[1]}.`);
      continue;
    }
    (patch as Record<string, unknown>)[key] = value;
  }

  // The calculation scope decides which accounts and sleeves every downstream
  // figure is measured against, so it is validated against the closed set.
  if (input.calculationScope !== undefined) {
    const scope = parseCalculationScope(input.calculationScope);
    if (scope) patch.calculationScope = scope;
    else rejected.push('calculationScope must be TAXABLE_INCOME_ENGINE, ALL_TAXABLE or ENTIRE_PORTFOLIO.');
  }

  if (input.wholePortfolioRules !== undefined) {
    const raw = input.wholePortfolioRules;
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      const rules: Partial<StrategyConfig['wholePortfolioRules']> = {};
      for (const key of ['concentration', 'exposure', 'sleeve'] as const) {
        const value = r[key];
        if (value === undefined) continue;
        if (typeof value === 'boolean') rules[key] = value;
        else rejected.push(`wholePortfolioRules.${key} must be a boolean.`);
      }
      if (Object.keys(rules).length) {
        patch.wholePortfolioRules = { ...DEFAULT_STRATEGY_CONFIG.wholePortfolioRules, ...rules };
      }
    } else {
      rejected.push('wholePortfolioRules must be an object of rule → boolean.');
    }
  }

  if (input.liquidityReserve !== undefined) {
    rejected.push(
      'liquidityReserve has been replaced by externalLiquidityTarget (the household reserve held outside the brokerages) and brokerCashFloor (the settlement buffer inside them).',
    );
  }

  if (input.distributionBasis !== undefined) {
    if (typeof input.distributionBasis === 'string' && BASES.has(input.distributionBasis)) {
      patch.distributionBasis = input.distributionBasis as StrategyConfig['distributionBasis'];
    } else {
      rejected.push('distributionBasis is not a recognised basis.');
    }
  }

  if (input.dipReference !== undefined) {
    if (typeof input.dipReference === 'string' && DIP_REFERENCES.has(input.dipReference)) {
      patch.dipReference = input.dipReference as StrategyConfig['dipReference'];
    } else {
      rejected.push('dipReference is not a recognised reference.');
    }
  }

  if (input.activeMilestoneId !== undefined) {
    const id = String(input.activeMilestoneId);
    if (MILESTONES.some((m) => m.id === id)) patch.activeMilestoneId = id;
    else rejected.push('activeMilestoneId is not a known milestone.');
  }

  if (input.targetDate !== undefined) {
    const value = input.targetDate;
    if (typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value))) {
      patch.targetDate = value;
    } else {
      rejected.push('targetDate must be an ISO date (YYYY-MM-DD), or an empty string to clear it.');
    }
  }

  if (input.killSwitch !== undefined) {
    if (typeof input.killSwitch === 'boolean') patch.killSwitch = input.killSwitch;
    else rejected.push('killSwitch must be a boolean.');
  }

  // Execution phase is deliberately not settable over HTTP. Advancing it is a
  // code change plus a deploy, reviewed as such.
  if (input.executionPhase !== undefined) {
    rejected.push('executionPhase cannot be changed through the API. It is a reviewed code change.');
  }

  if (input.incomeAllocationTargets !== undefined) {
    const raw = input.incomeAllocationTargets;
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
        .map(([k, v]) => [k.toUpperCase(), v as number] as const);
      const total = entries.reduce((acc, [, v]) => acc + v, 0);
      if (!entries.length) rejected.push('incomeAllocationTargets needs at least one symbol with a weight in 0-1.');
      else if (total > 1.0001) rejected.push('incomeAllocationTargets weights must not sum above 1.')
      else patch.incomeAllocationTargets = Object.fromEntries(entries);
    } else {
      rejected.push('incomeAllocationTargets must be an object of symbol → weight.');
    }
  }

  if (input.dipLevels !== undefined) {
    const raw = input.dipLevels;
    if (Array.isArray(raw)) {
      const levels = raw
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 0.9)
        .sort((a, b) => a - b);
      if (levels.length) patch.dipLevels = levels;
      else rejected.push('dipLevels must contain fractions between 0 and 0.9.');
    } else {
      rejected.push('dipLevels must be an array.');
    }
  }

  if (input.harvestRules !== undefined) {
    const raw = input.harvestRules;
    if (Array.isArray(raw)) {
      const rules = raw
        .map((item) => {
          if (typeof item !== 'object' || item === null) return null;
          const r = item as Record<string, unknown>;
          const symbol = typeof r.symbol === 'string' ? r.symbol.toUpperCase() : '';
          const destinationSymbol = typeof r.destinationSymbol === 'string' ? r.destinationSymbol.toUpperCase() : '';
          const triggerGainPct = typeof r.triggerGainPct === 'number' ? r.triggerGainPct : NaN;
          const harvestPortionPct = typeof r.harvestPortionPct === 'number' ? r.harvestPortionPct : NaN;
          if (!symbol || !destinationSymbol) return null;
          if (!(triggerGainPct > 0 && triggerGainPct <= 5)) return null;
          if (!(harvestPortionPct > 0 && harvestPortionPct <= 1)) return null;
          return {
            symbol,
            destinationSymbol,
            triggerGainPct,
            harvestPortionPct,
            enabled: r.enabled !== false,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rules.length === raw.length) patch.harvestRules = rules;
      else rejected.push('One or more harvest rules were malformed and the whole set was rejected.');
    } else {
      rejected.push('harvestRules must be an array.');
    }
  }

  if (input.trend !== undefined) {
    const raw = input.trend;
    if (typeof raw === 'object' && raw !== null) {
      const t = raw as Record<string, unknown>;
      const trend: Partial<StrategyConfig['trend']> = {};
      const numeric: [keyof StrategyConfig['trend'], number, number][] = [
        ['shortMaDays', 2, 100],
        ['mediumMaDays', 5, 200],
        ['longMaDays', 20, 400],
        ['rsiPeriod', 2, 50],
        ['rsiWeakBelow', 5, 60],
        ['rsiExtendedAbove', 50, 95],
        ['drawdownWarnPct', 0.01, 0.9],
        ['drawdownBreakPct', 0.02, 0.95],
      ];
      for (const [key, min, max] of numeric) {
        const value = t[key];
        if (value === undefined) continue;
        if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
          (trend as Record<string, unknown>)[key] = value;
        } else {
          rejected.push(`trend.${String(key)} must be between ${min} and ${max}.`);
        }
      }
      if (typeof t.benchmarkSymbol === 'string' && t.benchmarkSymbol.trim()) {
        trend.benchmarkSymbol = t.benchmarkSymbol.toUpperCase().trim();
      }
      if (Object.keys(trend).length) patch.trend = { ...DEFAULT_STRATEGY_CONFIG.trend, ...trend };
    } else {
      rejected.push('trend must be an object.');
    }
  }

  if (input.sleeveCeilings !== undefined) {
    const raw = input.sleeveCeilings;
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1,
      ) as [string, number][];
      patch.sleeveCeilings = Object.fromEntries(entries) as StrategyConfig['sleeveCeilings'];
    } else {
      rejected.push('sleeveCeilings must be an object of sleeve → fraction.');
    }
  }

  return { patch, rejected };
}

export default withErrorHandling('settings', async (req: Request) => {
  if (req.method === 'GET') {
    const { session, response } = await requireSession(req);
    if (response) return response;
    const loaded = await loadStrategyConfig();
    return json({
      config: loaded.config,
      defaults: DEFAULT_STRATEGY_CONFIG,
      persisted: loaded.persisted,
      note: loaded.note,
      databaseAttached: databaseAvailable(),
      milestones: MILESTONES,
      strategyLevels: STRATEGY_LEVELS,
      readOnly: session.mode === 'public_demo',
    });
  }

  if (req.method !== 'PUT') return methodNotAllowed(['GET', 'PUT']);

  const session = await verifySession(req);
  if (!session.authenticated) {
    const { response } = await requireSession(req);
    return response ?? fail(401, 'UNAUTHENTICATED', 'Sign in to change settings.');
  }
  // Demo mode may look, not touch.
  if (session.mode === 'public_demo') {
    return fail(403, 'READ_ONLY_DEMO', 'Public demo mode is read-only. Settings cannot be changed.');
  }

  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body || typeof body !== 'object') return fail(400, 'INVALID_BODY', 'A JSON object of settings is required.');

  const { patch, rejected } = sanitise(body);
  if (!Object.keys(patch).length) {
    return fail(400, 'NO_VALID_FIELDS', 'No valid settings were supplied.', { rejected });
  }

  const saved = await saveStrategyConfig(patch);
  await recordAudit({
    category: 'config',
    action: 'settings_updated',
    message: `Updated: ${Object.keys(patch).join(', ')}.`,
    detail: { patch, rejected, persisted: saved.persisted },
  });

  return json({ config: saved.config, persisted: saved.persisted, note: saved.note, rejected });
});
