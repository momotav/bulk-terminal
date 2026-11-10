// Fee arithmetic for the calculator. Pure, so it can be checked against BULK's own
// per-account quote (POST /account type feeTier) for a real wallet.

import type { FeeTierRow, MakerShareTier } from '@/lib/api';

/** The tier a 14-day volume falls in: the last whose threshold it has reached. */
export function tierIndex(tiers: FeeTierRow[], volume: number): number {
  let i = 0;
  tiers.forEach((t, k) => { if (volume >= t.thresholdVolume) i = k; });
  return i;
}

/** Maker rebate for a share of all maker volume, in parts per million. Negative bps = paid to you. */
export function makerRebate(tiers: MakerShareTier[], sharePpm: number): number {
  let bps = 0;
  for (const t of tiers) if (sharePpm >= t.thresholdPpm) bps = t.rebateBps;
  return bps;
}

/** Fees on `volume`, split by how much of it takes liquidity. Negative means net rebate. */
export function feeOn(volume: number, takerShare: number, takerBps: number, makerBps: number): number {
  return (volume * (takerShare * takerBps + (1 - takerShare) * makerBps)) / 10_000;
}
