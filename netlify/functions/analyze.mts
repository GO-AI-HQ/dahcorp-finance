import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { STANDING_QUESTIONS } from '../../src/agent/prompt.js';
import { prepareAnalysis, agentRequestFor, finalizePreparedAnalysis } from '../lib/analysisPipeline.mts';
import { startAgentRecommendation } from '../lib/agentAsync.mts';
import { issueAgentJobToken } from '../lib/agentJobToken.mts';

export default withErrorHandling('analyze', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = await readJsonBody<{ question?: string; capital?: number }>(req);
  const question = (body?.question ?? STANDING_QUESTIONS[0]).toString().slice(0, 600).trim();
  if (!question) return fail(400, 'MISSING_QUESTION', 'A question is required.');

  const prepared = await prepareAnalysis(question, body?.capital);
  const started = await startAgentRecommendation(agentRequestFor(question, prepared));

  if (started.state === 'pending') {
    const jobToken = await issueAgentJobToken({
      responseId: started.responseId,
      question,
      capital: prepared.capital,
      inputAsOf: prepared.ctx.snapshot.asOf,
    });
    return json({
      pending: true,
      status: started.status,
      jobToken,
      asOf: prepared.ctx.snapshot.asOf,
      question,
      capital: prepared.capital,
      model: started.model,
    }, 202, { 'Retry-After': '2' });
  }

  const result = await finalizePreparedAnalysis(question, prepared, started.agent);
  return json({ ...result, standingQuestions: STANDING_QUESTIONS });
});
