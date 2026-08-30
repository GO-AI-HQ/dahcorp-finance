export type AverageCostEffect = 'lower' | 'raise' | 'flat' | 'establish' | 'unknown';

export interface FractionalAddModel {
  dollars: number;
  estimatedShares: number;
  currentAverageCost: number | null;
  projectedAverageCost: number | null;
  averageCostEffect: AverageCostEffect;
}

/**
 * Deterministic fractional-share arithmetic for an illustrative add.
 *
 * This is not an allocation recommendation. It only answers: if a given dollar
 * amount were invested at the supplied price, how many shares would that buy
 * and how would the average cost per share change when cost basis is known?
 */
export function modelFractionalAdd(input: {
  price: number;
  dollars: number;
  currentShares?: number | null;
  currentCostBasisTotal?: number | null;
  costBasisKnown?: boolean;
}): FractionalAddModel | null {
  const price = Number(input.price);
  const dollars = Number(input.dollars);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(dollars) || dollars <= 0) return null;

  const shares = Math.max(0, Number(input.currentShares ?? 0));
  const estimatedShares = dollars / price;

  if (shares <= 0) {
    return {
      dollars,
      estimatedShares,
      currentAverageCost: null,
      projectedAverageCost: price,
      averageCostEffect: 'establish',
    };
  }

  const basis = Number(input.currentCostBasisTotal ?? 0);
  if (input.costBasisKnown === false || !Number.isFinite(basis) || basis <= 0) {
    return {
      dollars,
      estimatedShares,
      currentAverageCost: null,
      projectedAverageCost: null,
      averageCostEffect: 'unknown',
    };
  }

  const currentAverageCost = basis / shares;
  const projectedAverageCost = (basis + dollars) / (shares + estimatedShares);
  const delta = projectedAverageCost - currentAverageCost;
  const tolerance = Math.max(0.0001, currentAverageCost * 0.000001);
  const averageCostEffect: AverageCostEffect = Math.abs(delta) <= tolerance
    ? 'flat'
    : delta < 0
      ? 'lower'
      : 'raise';

  return {
    dollars,
    estimatedShares,
    currentAverageCost,
    projectedAverageCost,
    averageCostEffect,
  };
}
