import type { Config } from '@netlify/functions';
import { buildServerContext } from '../lib/context.mts';
import { recordAudit } from '../lib/store.mts';
import { saveShadowDecisions } from '../lib/shadowStore.mts';
import { buildSignalsPayload } from '../../src/services/analysis.js';
import { buildAgenticShadowDecisions } from '../../src/strategy/shadow.js';

/**
 * Weekday post-close evidence capture. 22:00 UTC is after the regular U.S.
 * equity close in both Eastern standard and daylight time.
 *
 * This function cannot place, preview or submit an order. It reads the same live
 * portfolio/market context as the dashboard and writes hypothetical decisions
 * to the Shadow ledger for later calibration.
 */
export const config: Config = {
  schedule: '0 22 * * 1-5',
};

export default async function handler() {
  const ctx = await buildServerContext();
  const agentic = ctx.snapshot.accounts.find(
    (account) => account.broker === 'robinhood' && account.tradeEligible,
  );

  if (!agentic) {
    await recordAudit({
      category: 'agent',
      action: 'shadow_observation_skipped',
      severity: 'warning',
      message: 'Agentic Shadow observation skipped because no live Robinhood Agentic account was available.',
    });
    return new Response(JSON.stringify({ ok: false, recorded: 0, reason: 'NO_AGENTIC_ACCOUNT' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signalPayload = buildSignalsPayload(ctx);
  const decisions = buildAgenticShadowDecisions({
    asOf: ctx.snapshot.asOf,
    config: ctx.config,
    signals: signalPayload.signals,
    semis: signalPayload.semis,
    agenticAccountId: agentic.id,
    cash: agentic.cash,
  });

  const recorded = await saveShadowDecisions(decisions);
  await recordAudit({
    category: 'agent',
    action: 'shadow_observation_run',
    severity: 'info',
    message: `Shadow Mode evaluated ${decisions.length} strategy decisions; ${recorded} new observations were recorded.`,
    detail: {
      marketDate: ctx.snapshot.asOf,
      evaluated: decisions.length,
      recorded,
      actions: decisions.reduce<Record<string, number>>((acc, decision) => {
        acc[decision.action] = (acc[decision.action] ?? 0) + 1;
        return acc;
      }, {}),
      // Provenance only. No account numbers, tokens or raw broker responses.
      dataQuality: ctx.snapshot.dataQuality,
      containsMockData: ctx.snapshot.containsMockData,
    },
  });

  return new Response(JSON.stringify({ ok: true, evaluated: decisions.length, recorded }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
