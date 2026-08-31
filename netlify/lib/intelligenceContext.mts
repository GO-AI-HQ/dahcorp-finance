import type { AdvancedEvidenceFabric } from './intelligenceV3.mts';

/**
 * Keep the model-facing research packet useful without dumping every raw source
 * row into the prompt. The complete evidence snapshot remains stored server-side.
 */
export function compactAdvancedEvidence(fabric: AdvancedEvidenceFabric) {
  return {
    version: fabric.version,
    asOf: fabric.asOf,
    lanes: fabric.lanes,
    coverage: fabric.fusion,
    options: fabric.options.slice(0, 12),
    fundLookThrough: fabric.fundLookThrough.slice(0, 8).map((fund) => ({
      symbol: fund.symbol,
      disclosedPositionCount: fund.disclosedPositionCount,
      topPositions: fund.topPositions.slice(0, 10),
    })),
    fundOverlap: fabric.fundOverlap.slice(0, 16),
    maritime: {
      chokepoints: fabric.maritime.chokepoints.slice(0, 10),
      ports: fabric.maritime.ports.slice(0, 10),
    },
    energy: {
      petroleum: fabric.energy.petroleum.slice(-10),
      shortTermOutlook: fabric.energy.shortTermOutlook.slice(-8),
      cftc: fabric.energy.cftc.slice(0, 6).map((row) => ({
        query: row.query,
        code: row.code,
        rows: row.rows.slice(0, 4),
      })),
    },
    company: {
      filings: fabric.company.filings.slice(0, 10).map((row) => ({
        symbol: row.symbol,
        periodEnding: row.periodEnding,
        calendarPeriod: row.calendarPeriod,
        filingUrl: row.filingUrl,
        mdnaExcerpt: row.mdnaExcerpt?.slice(0, 900) ?? null,
      })),
      insiders: fabric.company.insiders.slice(0, 12).map((row) => ({
        symbol: row.symbol,
        purchaseCount: row.purchaseCount,
        saleCount: row.saleCount,
        latestTransactionDate: row.latestTransactionDate,
      })),
    },
    earnings: fabric.earnings.slice(0, 14),
    crowding: fabric.crowding.slice(0, 14),
    governmentCapital: fabric.governmentCapital.slice(0, 20),
  };
}
