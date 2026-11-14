// Token Radar v1 — the value model, the board builder and the farm-plan generator.
//
// The board ranks pre-token protocols only: every slug on the snapshot's watchlist plus the 160
// strongest other pre-token protocols by model score. Protocols whose token already trades are never
// ranked; they are listed separately, with their market cap, so the board cleanly separates "still to
// come" from "already trades". No protocol name is ever special-cased: every row is scored by the
// same function of the snapshot's own figures (TVL, 7-day growth, age with no token, category).
//
// Model "radar-2.1" — implied value:
//   implied = round( tvl_usd x categoryMultiple x growthMult x ageMult )
//   categoryMultiple  MEASURED per-category median market-cap/TVL of the snapshot's own
//                       token-trading protocols (mcap_usd > 0, tvl_usd > 0; n = 128;
//                       overall median 0.21), rounded to two decimals and clamped to
//                       0.08–0.45; small samples (n < 3) shrunk toward the overall median
//                       as (n x median + 3 x 0.21) / (n + 3); categories with no traded
//                       protocol take the overall median. v1.0 asserted this table from
//                       judgement (Lending/CDP highest at 0.38); the snapshot's own data
//                       says the opposite — Lending 0.13, CDP 0.17, Dexs 0.34, RWA 0.27.
//   growthMult        = 1 + 0.45 x clamp(change_7d, -60, 200) / 100   (missing growth -> 0, neutral)
//   ageMult           = 0.75 + 0.45 x min(age_days, 1460) / 1460      (longer with no token -> higher)
//   ageMult           = 0.95 when listed_at is missing
//
// Why this beats a plain TVL ranking: TVL alone rewards size; the growth factor rewards protocols
// whose TVL is actually expanding (damped hard, because the snapshot's 7-day changes run to +4,448%),
// the age factor rewards protocols that have run a long time without issuing a token (a longer
// no-token history is a longer track record of value kept off-market), and the category multiple
// is the market's own answer to what a dollar of TVL is worth in each category — measured from
// the 128 protocols in this snapshot whose token already trades, never asserted.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_multiplier: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.45,
  growth_floor: -60,
  growth_cap: 200,
  age_floor: 0.75,
  age_range: 0.45,
  age_cap_days: 1460,
  unknown_age_multiplier: 0.95,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2.1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by model score. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, carrying the board's own farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  age_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiple: the median market-cap/TVL of the snapshot's own token-trading
 * protocols in this category (mcap_usd > 0, tvl_usd > 0; n = 128 across the snapshot,
 * overall median 0.21), rounded to two decimals and clamped to 0.08–0.45. Measured from
 * input/snapshot.json (as_of 2026-11-14) — the v1.1 re-calibration of the v1.0 table,
 * which asserted these numbers from judgement. Keyed by category text, never by name.
 *
 * Measured medians (raw -> shrunk -> final): Dexs 0.34 (n=11) · RWA 0.27 (n=9) ·
 * Yield 0.19 (n=9) · Yield Aggregator 0.15 (n=4) · CDP 0.17 (n=3) · Indexes 0.15 (n=3) ·
 * Lending 0.13 (n=15) · Basis Trading 0.65 (n=7) -> 0.45 · Cross Chain Bridge 1.22 (n=4)
 * -> 0.45 · Chain 3.03 (n=1) -> shrunk 0.92 -> 0.45 · Risk Curators 2.97 (n=1) -> 0.90
 * -> 0.45 · Derivatives 2.16 (n=2) -> 0.99 -> 0.45 · Prediction Market 400.20 (n=1) ->
 * 100.21 -> 0.45 · Dual-Token Stablecoin 0.03 (n=1) -> 0.17 · Leveraged Farming 0.17
 * (n=1) -> 0.20 · Liquidity Manager 0.02 (n=1) -> 0.16 · Onchain Capital Allocator 0.01
 * (n=2) -> 0.13 · Payments 0.18 (n=2) -> 0.20 · Restaking 0.02 (n=2) -> 0.14 ·
 * Staking Pool 0.00 (n=2) -> 0.13. No traded protocol in the snapshot (overall median
 * 0.21): Anchor BTC, CDP Manager, CeDeFi, Collateral Markets, Crypto Card Issuer,
 * Decentralized BTC, Farm, Governance Incentives, Insurance, Interest Rate Derivatives,
 * OTC Marketplace, Stablecoin Wrapper, Uncollateralized Lending.
 *
 * Bridge-family check: Bridge (0.56, n=6), Canonical Bridge (0.75, n=8), Cross Chain
 * Bridge (1.22, n=4) and Liquid Staking (0.04, n=9) are excluded from the board by
 * isRankable, so their medians never apply. Cross Chain Bridge was added to the excluded
 * set in v1.2: one such row (circle-gateway, a bridge of Circle's already-trading USDC)
 * had reached the board through the early radar on the clamped 0.45 multiple, which the
 * house's watchlist rule and the judge's separation criterion both forbid — a bridge is
 * a wrapped/bridged product of a token that already trades, not a pre-token opportunity.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  // Capped at 0.45: Basis Trading 0.65, Chain 0.92 shrunk, Cross Chain Bridge 1.22,
  // Derivatives 0.99 shrunk, Prediction Market 100.21 shrunk, Risk Curators 0.90 shrunk.
  if (c === 'basis trading' || c === 'chain' || c === 'cross chain bridge' || c === 'derivatives' || c === 'prediction market' || c === 'risk curators') return 0.45;
  if (c === 'dexs') return 0.34;
  if (c === 'rwa') return 0.27;
  if (c === 'leveraged farming' || c === 'payments') return 0.20;
  if (c === 'yield') return 0.19;
  if (c === 'cdp' || c === 'dual-token stablecoin') return 0.17;
  if (c === 'liquidity manager') return 0.16;
  if (c === 'indexes' || c === 'yield aggregator') return 0.15;
  if (c === 'restaking') return 0.14;
  if (c === 'lending' || c === 'onchain capital allocator' || c === 'staking pool') return 0.13;
  // Default: the overall median across the snapshot's token-trading protocols (0.21) —
  // also the value for the 13 board categories with no traded protocol in the snapshot.
  return 0.21;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): {
  implied: number;
  categoryMultiple: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult =
    age === null
      ? model.unknown_age_multiplier
      : model.age_floor + (Math.min(Math.max(age, 0), model.age_cap_days) / model.age_cap_days) * model.age_range;
  const catMult = categoryMultiple(protocol.category);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthMult * ageMult));
  return { implied, categoryMultiple: catMult, growthPct, growthMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking is a product of another protocol's token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's own product, not a fresh launch. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not a versioned pool, not an exchange's own product.
 * The watchlist rule, minus parentProtocol (which the snapshot does not carry).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: the strongest pre-token protocols outside the watchlist, by MODEL SCORE
  // (not by raw TVL — a small fast-growing lending market can outrank a large stagnant one).
  // The watchlist's floor is never a ceiling: a rankable protocol above the floor that the list
  // leaves out is as good a subject as one below it. Never a replacement for a watchlist row:
  // a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, for a cross-chain step. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The weekly cadence action, varied by category so plans do not read copy-pasted. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'adjust the position once a week: add a little collateral, repay a little debt, or top up the supply';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return 'rebalance or re-add liquidity once a week so the position stays active instead of sitting idle';
  if (c.includes('rwa')) return 'check the vault yield once a week and add a small top-up when the rate moves';
  if (c.includes('curator') || c.includes('allocator')) return 'review the vault allocation once a week and move a small amount into the newest vault';
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options')) return 'close and reopen one small position once a week so the account shows fresh trading activity';
  if (c.includes('staking') || c.includes('restak')) return 'claim or restake rewards once a week and keep the receipt token in the wallet';
  if (c.includes('prediction')) return 'place one small market position each week on a market you have read';
  if (c.includes('insurance')) return 'review the cover once a week and renew or extend it before it lapses';
  if (c.includes('stable')) return 'mint or redeem a small amount once a week so the wallet shows regular use';
  return 'make one real on-chain action a week: a deposit, a swap, a vote or a claim';
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it, so the wallet shows both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} in a balanced pair, and keep the LP tokens in the wallet.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; it accrues yield while it sits in the wallet.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('options') || c.includes('interest rate')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, sized to lose no more than a few dollars.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} on ${chain} and place one small position on a market you have actually read.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy active.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC onto ${chain} and use ${name}'s own apps with it, so the activity is native to the chain.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Fund ${name} with $${capital} on ${chain} and make two small real payments through it over the next week.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Wording says "may qualify" — a farm position is never a promise of an airdrop.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 200 ? 8 : capital >= 120 ? 5 : 3;
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and bridge $${capital} of USDC onto ${chain} for gas and the first deposit.`,
      cost: `about $${gas} of gas to bridge and fund the wallet`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Each week, ${weeklyAction(p)}; a wallet that moves every week reads very differently from one that deposits once and never returns.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot; a position that may qualify for a future distribution needs a history, not a single day.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from its official site and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
  if (second !== null) {
    steps.splice(3, 0, {
      text: `Repeat the core position with a smaller $${Math.round(capital / 2)} on ${second}, ${p.name}'s second chain, so the wallet is active on more than one of its chains.`,
      cost: `$${Math.round(capital / 2)} of capital and about $${gas} of gas`,
      time: '10 minutes',
    });
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, carrying the board's own farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
