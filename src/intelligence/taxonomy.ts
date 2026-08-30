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

/** Shipping is intentionally broader than the current IRA holdings so the
 * evidence lane can detect cross-subsector rotation before a symbol is owned. */
export const SHIPPING_INTELLIGENCE_SYMBOLS = [
  'INSW', 'DAC', 'GSL', 'CMBT', 'SBLK', 'ZIM', 'MATX', 'STNG', 'FRO',
] as const;

/** Quality-growth / AI-adjacent research lane. WMT is included because it is a
 * user-approved long-horizon DCA holding even though its GICS sector is retail. */
export const TECHNOLOGY_INTELLIGENCE_SYMBOLS = [
  'GOOGL', 'AMZN', 'WMT', 'MSFT', 'META', 'NVDA',
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

const SHIPPING_TERMS: Array<[RegExp, IntelligenceEventType, IntelligenceDirection, IntelligenceSeverity]> = [
  [/baltic dry.*(rise|surge|gain)|freight rate.*(rise|surge|jump|tight)/i, 'FREIGHT_RATE_RISE', 'constructive', 'medium'],
  [/baltic dry.*(fall|drop|decline)|freight rate.*(fall|drop|weak)/i, 'FREIGHT_RATE_FALL', 'restrictive', 'medium'],
  [/tanker.*(tight|shortage|strong rate|scarcity)|ton[- ]mile.*(increase|rise)/i, 'TANKER_TIGHTENING', 'constructive', 'medium'],
  [/dry bulk.*(tight|strong|recovery)|capesize.*(rise|strong)/i, 'DRY_BULK_TIGHTENING', 'constructive', 'medium'],
  [/container.*(tight|shortage|rate spike|strong rate)/i, 'CONTAINER_TIGHTENING', 'constructive', 'medium'],
  [/lng.*(carrier|shipping|vessel|freight|charter)/i, 'LNG_SHIPPING_CHANGE', 'mixed', 'medium'],
  [/vessel supply|fleet growth|scrapping|ship supply/i, 'VESSEL_SUPPLY_CHANGE', 'mixed', 'medium'],
  [/orderbook|newbuild|new build|shipyard slot/i, 'ORDERBOOK_CHANGE', 'mixed', 'medium'],
  [/suez|panama canal|canal disruption|canal transit/i, 'CANAL_DISRUPTION', 'mixed', 'high'],
  [/hormuz|strait of hormuz/i, 'HORMUZ_DISRUPTION', 'mixed', 'high'],
  [/red sea|houthi|bab el[- ]mandeb/i, 'RED_SEA_DISRUPTION', 'mixed', 'high'],
  [/port fee|shipping tariff|shipbuilding fee|u.s.-built ship/i, 'PORT_FEE_TARIFF', 'mixed', 'medium'],
  [/maritime sanction|shipping sanction|shadow fleet/i, 'MARITIME_SANCTIONS', 'mixed', 'high'],
  [/shipping stock|maritime investor|shipping investor|value investor'?s edge|christopher vonheim|j\.? mintzmyer|mintzmyer|sal mercogliano/i, 'SHIPPING_ANALYST_VIEW', 'mixed', 'low'],
];

const TECHNOLOGY_TERMS: Array<[RegExp, IntelligenceEventType, IntelligenceDirection, IntelligenceSeverity]> = [
  [/ai.*capex|hyperscaler.*capex|data center.*capex/i, 'AI_CAPEX_CHANGE', 'mixed', 'medium'],
  [/cloud.*(demand|growth|slow)|aws|azure|google cloud/i, 'CLOUD_DEMAND_CHANGE', 'mixed', 'medium'],
  [/advertising.*(demand|growth|slow)|digital ad/i, 'ADVERTISING_DEMAND_CHANGE', 'mixed', 'medium'],
  [/consumer spending|retail demand|e-commerce demand/i, 'RETAIL_DEMAND_CHANGE', 'mixed', 'medium'],
  [/antitrust|ai regulation|technology regulation|privacy rule/i, 'TECH_REGULATION', 'mixed', 'high'],
  [/alphabet.*earnings|amazon.*earnings|microsoft.*earnings|meta.*earnings|walmart.*earnings/i, 'MEGA_CAP_EARNINGS', 'mixed', 'medium'],
  [/valuation|multiple compression|multiple expansion|p\/e/i, 'TECH_VALUATION_CHANGE', 'mixed', 'low'],
];

const ALL_SYMBOLS = [
  ...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
  ...ENERGY_INTELLIGENCE_SYMBOLS,
  ...SHIPPING_INTELLIGENCE_SYMBOLS,
  ...TECHNOLOGY_INTELLIGENCE_SYMBOLS,
] as const;

export function symbolsForText(text: string): string[] {
  const upper = text.toUpperCase();
  return [...new Set(ALL_SYMBOLS)].filter((symbol) => new RegExp(`\\b${symbol}\\b`, 'i').test(upper));
}

export function sectorForText(text: string, symbols: string[] = []): IntelligenceSector {
  const upperSymbols = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const hasSemiSymbol = SEMICONDUCTOR_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const hasEnergySymbol = ENERGY_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const hasShippingSymbol = SHIPPING_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const hasTechSymbol = TECHNOLOGY_INTELLIGENCE_SYMBOLS.some((symbol) => upperSymbols.has(symbol));
  const semiText = /semiconductor|chip|foundry|lithograph|wafer|gpu|ai accelerator|taiwan semiconductor|chips act/i.test(text);
  const energyText = /energy|oil|gas|lng|grid|power|nuclear|uranium|opec|ferc|eia|reactor/i.test(text);
  const shippingText = /shipping|maritime|tanker|dry bulk|container ship|freight rate|baltic dry|vessel|shipyard|suez|hormuz|red sea|christopher vonheim|j\.? mintzmyer|mintzmyer|sal mercogliano/i.test(text);
  const technologyText = /alphabet|google|amazon|microsoft|meta|walmart|cloud|e-commerce|artificial intelligence|ai capex|mega-cap tech/i.test(text);
  const matches = [
    hasSemiSymbol || semiText ? 'semiconductors' : null,
    hasEnergySymbol || energyText ? 'energy' : null,
    hasShippingSymbol || shippingText ? 'shipping' : null,
    hasTechSymbol || technologyText ? 'technology' : null,
  ].filter(Boolean) as IntelligenceSector[];
  return matches.length === 1 ? matches[0] : 'cross_market';
}

export function classifyEvent(text: string, sector: IntelligenceSector): {
  eventType: IntelligenceEventType;
  direction: IntelligenceDirection;
  severity: IntelligenceSeverity;
} {
  const candidates = sector === 'energy'
    ? ENERGY_TERMS
    : sector === 'semiconductors'
      ? SEMI_TERMS
      : sector === 'shipping'
        ? SHIPPING_TERMS
        : sector === 'technology'
          ? TECHNOLOGY_TERMS
          : [...SEMI_TERMS, ...ENERGY_TERMS, ...SHIPPING_TERMS, ...TECHNOLOGY_TERMS];
  for (const [pattern, eventType, direction, severity] of candidates) {
    if (pattern.test(text)) return { eventType, direction, severity };
  }
  return { eventType: 'OTHER', direction: 'unknown', severity: 'info' };
}
