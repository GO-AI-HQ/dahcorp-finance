import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { STANDING_QUESTIONS } from '../../src/agent/prompt.js';
import { prepareAnalysis, finalizePreparedAnalysis } from '../lib/analysisPipeline.mts';
import { backgroundPollToAgentResult, pollOpenAIBackground } from '../lib/agentAsync.mts';
import { verifyAgentJobToken } from '../lib/agentJobToken.mts';

export default withErrorHandling('analyze-status', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = await readJsonBody<{ jobToken?: string }>(req);
  const token = typeof body?.jobToken === 'string' ? body.jobToken : '';
  if (!token) return fail(400, 'MISSING_JOB_TOKEN', 'A Treasury analysis job token is required.');

  const job = await verifyAgentJobToken(token);
  if (!job) return fail(410, 'INVALID_OR_EXPIRED_JOB', 'This Treasury analysis job is invalid or has expired. Please run the analysis again.');

  const poll = await pollOpenAIBackground(job.responseId);
  if (poll.state === 'pending') {
    return json({
      pending: true,
      status: poll.status,
      jobToken: token,
      asOf: job.inputAsOf,
      question: job.question,
      capital: job.capital,
      model: poll.model,
      modelDataProvenance: job.modelDataProvenance ?? null,
      modelInputFingerprint: job.modelInputFingerprint ?? null,
    }, 202, { 'Retry-After': '2' });
  }

  // The model reasoned against the original signed provenance/fingerprint in
  // the job token. Final deterministic validation intentionally uses the latest
  // available prepared state. We persist both lineages so a newer risk snapshot
  // can never be mistaken for the evidence the model originally received.
  const prepared = await prepareAnalysis(job.question, job.capital);
  const agent = backgroundPollToAgentResult(poll, prepared.deterministicBrief);
  const result = await finalizePreparedAnalysis(
    job.question,
    prepared,
    agent,
    job.inputAsOf,
    job.modelDataProvenance ?? prepared.dataProvenance,
    job.modelInputFingerprint ?? null,
  );
  return json({ ...result, standingQuestions: STANDING_QUESTIONS });
});
