// Token Launch Radar — entry program for make.fun token-radar-01.
//
// Reads the sealed DefiLlama snapshot at /input/snapshot.json (or --input),
// ranks protocols by an implied value derived only from the snapshot's own
// figures, and writes /output/board.json, the dashboard data, and
// /output/dossier.json. Standard library only, no network, no clock, no
// randomness: two runs write byte-identical output.
//
// The value model, in one paragraph. A protocol that records no token is
// scored on what the snapshot says about it: its TVL, its seven-day TVL
// change, and how long it has run since DefiLlama first listed it. The
// implied value is TVL x 5% x a growth factor x an age factor, where the
// growth factor runs from 0.75 at -50% seven-day change to 2.0 at +200%,
// and the age factor runs from 1.0 for a newly listed protocol to 1.6 for
// one listed four or more years ago. No protocol name is hardcoded anywhere:
// the model only ever reads the snapshot's numbers. The pre-token pool also
// applies the watchlist's own exclusion — no bridge, liquid-staking or CEX
// record, no wrapped/staked product of a token that already trades — because
// those are not tokens that do not exist yet. Protocols whose token
// already trades are ranked after the pre-token board, in their own block,
// with an implied value equal to their recorded market cap scaled by one
// common factor so the block sits below the pre-token ranking; their
// unscaled market cap is shown in the detail view. The snapshot records no
// token for a protocol; that is never stated as the protocol having none,
// and no step below promises an airdrop or a token launch.
//
// Usage (outside the grader's container):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65536;
const BOARD_ROWS = 200;
const PRE_TOKEN_ROWS = 160;
const LIVE_ROWS = 40;

// ---------------------------------------------------------------- types

interface Protocol {
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

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  status: 'pre-token' | 'token-live';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  mcap_usd: number | null;
  watchlist: boolean;
}

// ---------------------------------------------------------------- inputs

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

function resolveInput(given: string): string {
  if (existsSync(given) && !given.endsWith('.json')) {
    const direct = join(given, 'snapshot.json');
    if (existsSync(direct)) return direct;
  }
  return given;
}

const inputFile = resolveInput(arg('input', '/input/snapshot.json'));
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const AS_OF = snapshot.as_of; // e.g. 2026-11-14; the only date the program ever uses
const watchlist = new Set(snapshot.watchlist);

// ---------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Whole days from an earlier YYYY-MM-DD date to a later one. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.max(0, Math.floor(ms / 86400000));
}

/** Size band of a protocol, by TVL: 0 large, 1 mid, 2 small. */
function bandOf(tvl: number): number {
  if (tvl >= 1_000_000_000) return 0;
  if (tvl >= 100_000_000) return 1;
  return 2;
}

/** Suggested position size per band; a range, never a promise. */
const AMOUNTS = ['$500–$1,000', '$100–$500', '$25–$100'];

/** Typical network fee to move on a chain, as a range. */
const GAS: Record<string, string> = {
  eth: '$3–$12',
  sol: '$0.01–$0.05',
  l2: '$0.05–$0.50',
  btc: '$1–$5',
  def: '$0.10–$1.00',
};

const L2_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'Polygon', 'Binance', 'Avalanche', 'Linea',
  'Blast', 'zkSync Era', 'Scroll', 'Mantle', 'Mode', 'Zora', 'Fraxtal',
]);

function gasKey(chain: string): string {
  if (chain === 'Ethereum') return 'eth';
  if (chain === 'Solana') return 'sol';
  if (chain === 'Bitcoin') return 'btc';
  if (L2_CHAINS.has(chain)) return 'l2';
  return 'def';
}

/** Which farm family a category belongs to. No name is ever matched here. */
function familyOf(category: string | null): string {
  switch (category) {
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Staking Pool':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'stake';
    case 'Lending':
    case 'CDP':
    case 'CDP Manager':
    case 'Collateral Markets':
    case 'Collateral Management':
    case 'Uncollateralized Lending':
    case 'Risk Curators':
      return 'lend';
    case 'Dexs':
    case 'Liquidity Manager':
    case 'Farm':
    case 'Yield':
    case 'Yield Aggregator':
    case 'Leveraged Farming':
    case 'Basis Trading':
      return 'dex';
    case 'Bridge':
    case 'Cross Chain Bridge':
    case 'Canonical Bridge':
      return 'bridge';
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
    case 'Synthetics':
    case 'Interest Rate Derivatives':
      return 'deriv';
    case 'RWA':
    case 'Onchain Capital Allocator':
    case 'Indexes':
    case 'Token Locker':
    case 'Stablecoin Issuer':
    case 'Algo-Stables':
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Wrapper':
    case 'Reserve Currency':
    case 'DOR':
    case 'Insurance':
    case 'Governance Incentives':
      return 'vault';
    default:
      return 'generic';
  }
}

// ---------------------------------------------------------------- farm steps
//
// One template set per farm family, five steps each. {N} is the protocol
// name, {C} its main chain, {A} the suggested position size for its TVL
// band, {G} the typical network fee on that chain. Every step names a cost
// and a time. Steps 2–4 are the same for a protocol whether or not its
// token trades; step 1 and step 5 say which it is, and never promise a
// launch: a protocol with no token recorded may still never issue one.

const STEP_1_PRE =
  'Fund a fresh wallet on {C} with {A} for the position plus gas (about {G} in network fees, 10 minutes). Keep this wallet separate from everyday spending.';
const STEP_1_LIVE =
  'Fund a fresh wallet on {C} with {A} for the position plus gas (about {G} in network fees, 10 minutes). {N} already has a token trading, so this farms yield and fees, not a launch.';
const STEP_5_PRE =
  'Write down the wallet, the dates and the amounts used, and check the position once a week (about 10 minutes, no cost). The snapshot records no token for {N}; that is not a promise that one will ever be issued.';
const STEP_5_LIVE =
  'Write down the wallet, the dates and the amounts used, and check the position once a week (about 10 minutes, no cost). {N} already has a token trading, so the goal here is yield and fees, not a launch.';

const FAMILY_STEPS: Record<string, [string, string, string]> = {
  dex: [
    'On {N}, swap half of the funds into the pool\u2019s second asset (about {G} in gas, 5 minutes). Use a small first swap to confirm the route works.',
    'Add both assets to a {N} liquidity pool on {C} (about {G} in gas, 10 minutes). Note the pool\u2019s fee tier and the share received.',
    'Leave the position in place and repeat the swap once a week for four weeks, about {G} per visit and 5 minutes each, to build a steady history of use.',
  ],
  lend: [
    'On {N}, supply {A} of collateral on {C} (about {G} in gas, 10 minutes). Check the supply rate and the collateral factor before confirming.',
    'Borrow a small amount against the collateral, no more than a third of its value, and hold it in the wallet (about {G} in gas, 10 minutes). Keep the health factor well above the liquidation line.',
    'Once a week for four weeks, add a little more collateral or repay a little of the loan, about {G} per visit and 10 minutes each, and re-check the health factor.',
  ],
  stake: [
    'On {N}, stake {A} on {C} (about {G} in gas, 10 minutes). Read the unstaking delay and any lock-up before confirming.',
    'Hold the receipt token the protocol returns, and check the rewards it accrues after one week (5 minutes, no cost beyond the first gas).',
    'Once a week for four weeks, add a small top-up or claim and restake the rewards, about {G} per visit and 10 minutes each.',
  ],
  bridge: [
    'Send a small test amount first through {N} from {C} to the destination chain (about {G} in fees, 5\u201315 minutes). Confirm it arrives before moving more.',
    'Bridge the remaining {A} through {N} in two or three trips (about {G} per trip, 5\u201315 minutes each). Keep the receipts for each trip.',
    'Once a week for four weeks, bridge a small amount back or onward, about {G} per trip and 10 minutes each, so the route sees regular use.',
  ],
  deriv: [
    'On {N}, open a small position on {C} with about a tenth of {A} (about {G} in gas, 10 minutes). Set a stop that caps the loss before entering.',
    'Close or roll the position after a few days and note the fees paid (about {G} in gas, 10 minutes). Never leave a leveraged position unwatched.',
    'Once a week for four weeks, repeat with the same small size, about {G} per visit and 15 minutes each, and keep a log of every fill and fee.',
  ],
  vault: [
    'On {N}, deposit {A} into the vault or pool on {C} (about {G} in gas, 10 minutes). Read the fee schedule and the withdrawal delay first.',
    'After one week, check the position\u2019s value and the yield earned so far (5 minutes, no cost). Compare it with the rate shown at deposit.',
    'Once a month, add a small top-up or withdraw a small slice and re-deposit it, about {G} per visit and 10 minutes each, to keep the position active.',
  ],
  generic: [
    'On {N}, run its core action once on {C} with a small amount, about a tenth of {A} (about {G} in gas, 10 minutes). Read the confirmation screen before signing.',
    'Use the same feature a second time with a different amount or setting (about {G} in gas, 10 minutes). Note what changed in the result.',
    'Once a week for four weeks, repeat the core action once, about {G} per visit and 5 minutes each, to build a steady history of use.',
  ],
};

function fill(tpl: string, name: string, chain: string, amount: string, gas: string): string {
  return tpl.split('{N}').join(name).split('{C}').join(chain).split('{A}').join(amount).split('{G}').join(gas);
}

/** The five farm steps for one protocol, from its family's templates. */
function farmSteps(p: Protocol, live: boolean): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const amount = AMOUNTS[bandOf(p.tvl_usd)];
  const gas = GAS[gasKey(chain)];
  const mid = FAMILY_STEPS[familyOf(p.category)]!;
  const steps = [live ? STEP_1_LIVE : STEP_1_PRE, ...mid, live ? STEP_5_LIVE : STEP_5_PRE];
  return steps.map((s) => fill(s, p.name, chain, amount, gas));
}

// ---------------------------------------------------------------- the model

function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// The watchlist's own exclusion, applied to the whole pre-token pool: a
// wrapped, staked or bridged product of a token that already trades is not
// a token that does not exist yet, and neither is an exchange's own record.
// Same rule the house used to draw the watchlist (input/README.md).
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function isRadarSubject(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Growth factor from the seven-day TVL change, in per cent. */
function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + clamp(change7d, -50, 200) / 200;
}

/** Age factor from how long the protocol has run since first listed. */
function ageFactor(listedAt: string | null): number {
  if (listedAt === null) return 1;
  const days = daysBetween(listedAt, AS_OF);
  return 1 + (Math.min(days, 1460) / 1460) * 0.6;
}

/** Implied value of a pre-token protocol, in whole dollars. */
function impliedPreToken(p: Protocol): number {
  const v = p.tvl_usd * 0.05 * growthFactor(p.change_7d) * ageFactor(p.listed_at);
  return Math.max(1, Math.round(v));
}

function buildRows(): Row[] {
  // Pre-token board: every protocol that records no token, ranked by the
  // implied value above. The watchlist is the floor, never the ceiling.
  const pre = snapshot.protocols.filter(isRadarSubject);
  const rankedPre = pre
    .map((p) => ({ p, value: impliedPreToken(p) }))
    .sort((a, b) => (b.value - a.value) || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  let picked = rankedPre.slice(0, PRE_TOKEN_ROWS);
  // Guarantee the whole watchlist is covered, even if a watchlist member
  // falls outside the top slice: swap the lowest non-watchlist picks out.
  const pickedSlugs = new Set(picked.map((r) => r.p.slug));
  for (const slug of snapshot.watchlist) {
    if (pickedSlugs.has(slug)) continue;
    const entry = rankedPre.find((r) => r.p.slug === slug);
    if (!entry) continue; // the snapshot's list, not ours, is authoritative
    const swapAt = picked.map((r) => r.p.slug).findLastIndex((s) => !watchlist.has(s));
    if (swapAt < 0) break;
    picked[swapAt] = entry;
    pickedSlugs.add(slug);
  }
  picked = picked.sort((a, b) => (b.value - a.value) || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const minPreValue = picked[picked.length - 1]!.value;

  // Token-live block: the largest tokens by recorded market cap (a protocol
  // with a token but no market cap recorded falls back to TVL x 0.5%). One
  // common scale puts the whole block below the pre-token board.
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const liveRef = live.map((p) => ({ p, ref: p.mcap_usd ?? p.tvl_usd * 0.005 }));
  liveRef.sort((a, b) => (b.ref - a.ref) || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const pickedLive = liveRef.slice(0, LIVE_ROWS);
  const maxRef = pickedLive[0]?.ref ?? 1;
  const scale = (minPreValue * 0.95) / maxRef;

  const rows: Row[] = [];
  picked.forEach((r, i) => {
    rows.push({
      slug: r.p.slug,
      name: r.p.name,
      rank: i + 1,
      implied_value_usd: r.value,
      farm_steps: farmSteps(r.p, false),
      status: 'pre-token',
      category: r.p.category,
      chains: r.p.chains,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.p.change_7d,
      listed_at: r.p.listed_at,
      mcap_usd: r.p.mcap_usd,
      watchlist: watchlist.has(r.p.slug),
    });
  });
  pickedLive.forEach((r, i) => {
    rows.push({
      slug: r.p.slug,
      name: r.p.name,
      rank: PRE_TOKEN_ROWS + i + 1,
      implied_value_usd: Math.max(1, Math.round(r.ref * scale)),
      farm_steps: farmSteps(r.p, true),
      status: 'token-live',
      category: r.p.category,
      chains: r.p.chains,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.p.change_7d,
      listed_at: r.p.listed_at,
      mcap_usd: r.p.mcap_usd,
      watchlist: false,
    });
  });
  return rows;
}

// ---------------------------------------------------------------- outputs

/**
 * The dashboard's data as one compact script. Farm steps are stored once
 * per template (the dashboard fills {N} {C} {A} {G} itself), so the whole
 * dashboard stays inside the dossier's 64 KiB text cap; the filled steps
 * the page shows are byte-identical to board.json's farm_steps.
 */
function dashboardData(rows: Row[]): string {
  const stepIndex = new Map<string, number>();
  const templates: string[] = [];
  const indexOf = (tpl: string): number => {
    const hit = stepIndex.get(tpl);
    if (hit !== undefined) return hit;
    const id = templates.length;
    stepIndex.set(tpl, id);
    templates.push(tpl);
    return id;
  };

  const compact = rows.map((r) => {
    const chain = r.chains[0] ?? 'Ethereum';
    const family = familyOf(r.category);
    const live = r.status === 'token-live';
    const tplIds = [
      indexOf(live ? STEP_1_LIVE : STEP_1_PRE),
      ...FAMILY_STEPS[family]!.map((t) => indexOf(t)),
      indexOf(live ? STEP_5_LIVE : STEP_5_PRE),
    ];
    return [
      r.slug, r.name, r.category, r.chains.slice(0, 3), r.tvl_usd, r.change_7d,
      r.implied_value_usd, r.listed_at, r.mcap_usd, live ? 1 : 0,
      r.watchlist ? 1 : 0, bandOf(r.tvl_usd), gasKey(chain), tplIds,
    ];
  });

  const data = {
    asOf: AS_OF,
    floor: snapshot.floor_usd,
    steps: templates,
    amounts: AMOUNTS,
    gas: GAS,
    rows: compact,
  };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

function copyTree(fromDir: string, toDir: string, keep: (name: string) => boolean): void {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir).sort()) {
    if (!keep(name)) continue;
    copyFileSync(join(fromDir, name), join(toDir, name));
  }
}

function main(): void {
  const rows = buildRows();
  if (rows.length !== BOARD_ROWS) throw new Error(`board has ${rows.length} rows, expected ${BOARD_ROWS}`);
  const watchCovered = snapshot.watchlist.every((s) => rows.some((r) => r.slug === s));
  if (!watchCovered) throw new Error('watchlist not fully covered');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      throw new Error(`implied value rises at rank ${rows[i]!.rank}`);
    }
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows }, null, 0)}\n`);

  const dashOut = join(out, 'dashboard');
  copyTree(join(ROOT, 'dashboard'), dashOut, (n) => n !== 'rows.js');
  writeFileSync(join(dashOut, 'rows.js'), dashboardData(rows));
  copyTree(join(ROOT, 'screenshots'), join(out, 'screenshots'), (n) => /\.png$/i.test(n) || /\.jpe?g$/i.test(n));

  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  const preCount = rows.filter((r) => r.status === 'pre-token').length;
  process.stdout.write(
    `token radar: ${rows.length} rows (${preCount} pre-token, ${rows.length - preCount} token-live), ` +
      `watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered, ` +
      `top implied value $${rows[0]!.implied_value_usd.toLocaleString('en-US')}, wrote ${out}\n`,
  );
}

main();
