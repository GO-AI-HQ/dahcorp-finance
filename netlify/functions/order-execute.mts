import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { recordAudit } from '../lib/store.mts';

/**
 * POST /.netlify/functions/order-execute — DISABLED.
 *
 * This endpoint exists so the shape of the eventual integration is fixed and
 * reviewable, and so any attempt to reach it is recorded. It contains no broker
 * client, no credential read and no order construction: there is deliberately no
 * code path from this file to a brokerage API.
 *
 * Enabling execution is not a matter of flipping a flag here. It requires, in
 * order: Phase 4 approval mode in the UI, the execution phase allow-list in
 * src/risk/engine.ts, per-account trade eligibility, encrypted server-side token
 * storage, and a broker adapter that advertises the place_order capability. None
 * of those exist in this build.
 */
export default withErrorHandling('order-execute', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  await recordAudit({
    category: 'order',
    action: 'execute_attempt_blocked',
    severity: 'warning',
    message: 'An execution attempt reached the disabled endpoint and was refused.',
  });

  return json(
    {
      error: {
        code: 'EXECUTION_DISABLED',
        message:
          'Live order execution is disabled. This build implements Phase 1 (observer): orders can be validated and previewed, never placed.',
      },
      executionEnabled: false,
      phase: 1,
      requiredForExecution: [
        'Phase 4 approval workflow in the UI',
        'Execution phase added to the allow-list in src/risk/engine.ts',
        'Per-account trade eligibility enabled',
        'Encrypted server-side storage for broker OAuth refresh tokens',
        'A broker adapter advertising the place_order capability',
      ],
    },
    403,
  );
});
