import { json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession, verifySession } from '../lib/session.mts';
import { fail } from '../lib/http.mts';
import {
  databaseAvailable,
  listAuditLog,
  listOrderPreviews,
  listRecommendations,
  recordAudit,
  setRecommendationAction,
} from '../lib/store.mts';

/**
 * GET  /.netlify/functions/activity — the audit trail.
 * POST /.netlify/functions/activity — record the human decision on a recommendation.
 *
 * Recording APPROVE / REJECT / EDIT here does not execute anything. It closes
 * the audit loop so the eventual quality of each recommendation can be judged
 * against what was actually decided.
 */
export default withErrorHandling('activity', async (req: Request) => {
  if (req.method === 'GET') {
    const { response } = await requireSession(req);
    if (response) return response;

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const [recommendations, previews, events] = await Promise.all([
      listRecommendations(limit),
      listOrderPreviews(limit),
      listAuditLog(limit),
    ]);

    return json({
      databaseAttached: databaseAvailable(),
      note: databaseAvailable()
        ? null
        : 'No database is attached, so history is not retained. Audit entries are written to the function logs only.',
      recommendations,
      orderPreviews: previews,
      events,
    });
  }

  if (req.method !== 'POST') return methodNotAllowed(['GET', 'POST']);

  const session = await verifySession(req);
  if (!session.authenticated) {
    const { response } = await requireSession(req);
    return response ?? fail(401, 'UNAUTHENTICATED', 'Sign in to record a decision.');
  }
  if (session.mode === 'public_demo') {
    return fail(403, 'READ_ONLY_DEMO', 'Public demo mode is read-only.');
  }

  const body = await readJsonBody<{ recommendationId?: unknown; action?: unknown; note?: unknown }>(req);
  const id = typeof body?.recommendationId === 'number' ? body.recommendationId : null;
  const action = body?.action;
  if (id == null || (action !== 'approved' && action !== 'rejected' && action !== 'edited')) {
    return fail(400, 'INVALID_DECISION', 'recommendationId and an action of approved | rejected | edited are required.');
  }

  const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;
  const updated = await setRecommendationAction(id, action, note);
  await recordAudit({
    category: 'agent',
    action: `recommendation_${action}`,
    message: updated
      ? `Recommendation ${id} marked ${action}.`
      : `Recommendation ${id} could not be updated (missing, or already decided).`,
    detail: { recommendationId: id, action, note },
  });

  if (!updated) {
    return fail(409, 'NOT_UPDATED', 'That recommendation was not found, or a decision was already recorded for it.');
  }

  return json({
    recommendationId: id,
    userAction: action,
    executed: false,
    note: 'Decision recorded for the audit trail. Execution remains disabled in this build.',
  });
});
