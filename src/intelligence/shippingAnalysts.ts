export interface ShippingAnalystReference {
  name: string;
  shortName: string;
  homepage: string;
  social?: string;
  automation: 'public_feed' | 'curated_reference';
  focus: string;
  note: string;
}

/**
 * Named specialist sources for the Shipping intelligence lane.
 *
 * `public_feed` means DAHCorp may normalize a permitted public feed.
 * `curated_reference` means the source is intentionally not scraped when its
 * terms prohibit commercial feed use; it can still be used for attribution,
 * manual research prompts and permitted downstream mentions.
 */
export const SHIPPING_ANALYST_REFERENCES: ShippingAnalystReference[] = [
  {
    name: 'Vonheim / Christopher Vonheim',
    shortName: 'Christopher Vonheim',
    homepage: 'https://shows.acast.com/bynn-with-christopher-vonheim',
    automation: 'public_feed',
    focus: 'Shipping cycles, maritime equities and industry interviews',
    note: 'Public podcast feed is normalized as analyst commentary and always requires corroboration.',
  },
  {
    name: "What's Going on With Shipping / Sal Mercogliano",
    shortName: 'Sal Mercogliano',
    homepage: 'https://www.youtube.com/@wgowshipping',
    automation: 'public_feed',
    focus: 'Maritime operations, logistics, policy and shipping disruptions',
    note: 'Public podcast feed is normalized as analyst commentary and always requires corroboration.',
  },
  {
    name: 'J Mintzmyer',
    shortName: 'J Mintzmyer',
    homepage: 'https://seekingalpha.com/author/j-mintzmyer',
    social: 'https://x.com/mintzmyer',
    automation: 'curated_reference',
    focus: 'Shipping equities, dry bulk, tankers, containers and cycle valuation',
    note: 'Seeking Alpha author RSS is not ingested because the supplied feed limits use to personal, non-commercial purposes. Permitted downstream mentions and manual research remain corroborative inputs.',
  },
];
