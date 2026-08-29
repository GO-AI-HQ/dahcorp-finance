import type {
  IntelligenceDirection,
  IntelligenceEventType,
  IntelligenceSector,
  IntelligenceSeverity,
} from './types.js';

export const SEMICONDUCTOR_INTELLIGENCE_SYMBOLS = [
  'SEMI', 'SMH', 'AMD', 'NVDA', 'TSM', 'ASML', 'QCOM', 'TXN', 'MU', 'MRVL', 'SOXL', 'TSMX',
] as const;

export const ENERGY_INTELLIGENCE_SYMBOLS = [
  'CCJ', 'URA', 'CEG', 'VST', 'XLE', 'XLU',
] as const;

const SEMI_TERMS: Array<[RegExp, IntelligenceEventType, IntelligenceDirection, IntelligenceSeverity]> = [
  [/export control|export restriction|entity list|advanced chip|lithograph/i, 'EXPORT_CONTROL_TIGHTEN', 'restrictive', 'high'],
  [/relax.*export|ease.*restriction|remove.*entity list/i, 'EXPORT_CONTROL_RELAX', 'constructive', 'high'],
  [/chips act|chips program|semiconductor (grant|award|funding|subsid)/i, 'CHIPS_FUNDING', 'constructive', 'medium'],
  [/tariff|trade restriction|trade action/i, 'TRADE_TARIFF_ACTION', 'mixed', 'medium'],
  [/fab (expansion|build|construction)|new fab|capacity expansion/i, 'FAB_EXPANSION', 'constructive', 'medium'],
  [/fab delay|construction delay|fab postpon/i, 'FAB_DELAY', 'restrictive', 'medium'],
  [/capex (raise|increase|boost)|raise.*capex/i, 'CAPEX_RAISE', 'constructive', 'medium'],
  [/capex (cut|reduce|lower)|cut.*capex/i, 'CAPEX_CUT', 'restrictive', 'medium'],
  [/ai demand|accelerator demand|hyperscaler.*capex/i, 'AI_DEMAND_RAISE', 'constructive', 'medium'],
  [/inventory (clear|normaliz|decline)|destocking.*end/i, 'INVENTORY_CLEAR', 'constructive', 'medium'],
  [/inventory (build|surplus|glut)|oversupply/i, 'INVENTORY_BUILD', 'restrictive', 'medium'],
  [/taiwan.*(tension|military|blockade|conflict)|strait.*escalat/i, 'TAIWAN_SECURITY_ESCALATE', 'restrictive', 'high'],
  [/taiwan.*(de-escalat|stabil)|strait.*de-escalat/i, 'TAIWAN_SECURITY_DEESCALATE', 'constructive', 'medium'],
  [/earnings|guidance|revenue forecast/i, 'EARNINGS_GUIDANCE_SHOCK', 'mixed', 'medium'],
];

const ENERGY_TERMS: Array<[RegExp, IntelligenceEventType, IntelligenceDirection, IntelligenceSeverity]> = [
  [/opec.*(cut|reduce).*production/i, 'OPEC_PRODUCTION_CUT', 'constructive', 'high'],
  [/opec.*(raise|increase).*production/i, 'OPEC_PRODUCTION_RAISE', 'restrictive', 'high'],
  [/eia.*inventor|crude inventor|natural gas storage/i, 'EIA_INVENTORY_SURPRISE', 'mixed', 'medium'],
  [/ferc.*(approv|authorize)/i, 'FERC_APPROVAL', 'constructive', 'medium'],
  [/ferc.*(reject|deny|restrict)/i, 'FERC_RESTRICTION', 'restrictive', 'medium'],
  [/lng.*(capacity|terminal|export)/i, 'LNG_CAPACITY_CHANGE', 'mixed', 'medium'],
  [/sanction.*(tighten|expand|new)|new sanction/i, 'SANCTIONS_TIGHTEN', 'mixed', 'high'],
  [/sanction.*(ease|relax|lift)/i, 'SANCTIONS_RELAX', 'mixed', 'medium'],
  [/grid.*(investment|funding|transmission)|transmission.*funding/i, 'GRID_CAPEX', 'constructive', 'medium'],
  [/nuclear|reactor|uranium policy|nrc|enrichment/i, 'NUCLEAR_POLICY', 'constructive', 'medium'],
  [/uranium.*(shortage|supply|mine disruption)|mine.*uranium/i, 'URANIUM_SUPPLY_SHOCK', 'constructive', 'high'],
  [/power demand|electricity demand|data center.*power|hyperscaler.*power/i, 'POWER_DEMAND_CHANGE', 'constructive', 'medium'],
];

export function symbolsForText(text: string): string[] {
  const upper = text.toUpperCase();
  return [...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS, ...ENERGY_INTELLIGENCE_SYMBOLS]
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`, 'i').test(upper));
}

export function sectorForText(text: string, symbols: string[] = []): IntelligenceSector {
  const upperSymbols = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const hasSemiSymbol = SEMICONDUCTOR_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const hasEnergySymbol = ENERGY_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const semiText = /semiconductor|chip|foundry|lithograph|wafer|gpu|ai accelerator|taiwan semiconductor|chips act/i.test(text);
  const energyText = /energy|oil|gas|lng|grid|power|nuclear|uranium|opec|ferc|eia|reactor/i.test(text);
  if ((hasSemiSymbol || semiText) && (hasEnergySymbol || energyText)) return 'cross_market';
  if (hasSemiSymbol || semiText) return 'semiconductors';
  if (hasEnergySymbol || energyText) return 'energy';
  return 'cross_market';
}

export function classifyEvent(text: string, sector: IntelligenceSector): {
  eventType: IntelligenceEventType;
  direction: IntelligenceDirection;
  severity: IntelligenceSeverity;
} {
  const candidates = sector === 'energy' ? ENERGY_TERMS : sector === 'semiconductors' ? SEMI_TERMS : [...SEMI_TERMS, ...ENERGY_TERMS];
  for (const [pattern, eventType, direction, severity] of candidates) {
    if (pattern.test(text)) return { eventType, direction, severity };
  }
  return { eventType: 'OTHER', direction: 'unknown', severity: 'info' };
}
