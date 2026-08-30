import { describe, expect, it } from 'vitest';
import { buildSemanticModelUnavailableBrief, requiresSemanticModel } from '../src/agent/fallback.js';

describe('semantic fallback guard', () => {
  it('keeps standing allocation questions eligible for deterministic policy', () => {
    expect(requiresSemanticModel('Where should my next dollar go?')).toBe(false);
    expect(requiresSemanticModel('What gets me to $500/month fastest without unacceptable risk?')).toBe(false);
  });

  it('detects bespoke ticker transaction and replacement questions', () => {
    expect(requiresSemanticModel('Selling YMAG in Schwab and replacing that with YMAX')).toBe(true);
    expect(requiresSemanticModel('Should I buy GOOGL now or hold cash?')).toBe(true);
    expect(requiresSemanticModel('Reduce WMT and move that capital into AMZN')).toBe(true);
  });

  it('returns no transaction legs when semantic interpretation is unavailable', () => {
    const brief = buildSemanticModelUnavailableBrief('Sell YMAG and replace it with YMAX', 10.35);
    expect(brief.legs).toEqual([]);
    expect(brief.headline).toContain('no bespoke transaction modeled');
    expect(brief.thesis).toContain('Preserve 10.35');
  });
});
