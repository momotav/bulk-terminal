'use client';

import type { ReactNode } from 'react';
import { ArrowLeftRight, Calculator, Eye, Percent, Radio } from 'lucide-react';
import { formatAddress } from '@/lib/api';
import { dock, type Win, type WinKind } from '@/lib/basket';
import { CoinIcon } from '@/components/CoinIcon';
import { BulkAvatar } from '@/components/BulkAvatar';
import { WalletWatch } from './WalletWatch';
import { PairChart } from './PairChart';
import { CalcView } from './CalcView';
import { TapeView } from './TapeView';
import { FundingBoard } from './FundingBoard';

export type ToolKind = Exclude<WinKind, 'chart' | 'basket' | 'book'>;
export const TOOL_KINDS: ToolKind[] = ['wallet', 'pair', 'calc', 'tape', 'funding'];
export const isTool = (k: WinKind): k is ToolKind => (TOOL_KINDS as string[]).includes(k);

/** The "+" menu entries for the tools, in order. */
export const TOOL_MENU: { kind: ToolKind; title: string; sub: string; icon: ReactNode }[] = [
  { kind: 'wallet', title: 'Wallet watch', sub: 'A wallet live: PnL, positions, new fills', icon: <Eye className="h-4 w-4" /> },
  { kind: 'pair', title: 'Pair chart', sub: 'One market priced in another, e.g. BTC/ETH', icon: <ArrowLeftRight className="h-4 w-4" /> },
  { kind: 'calc', title: 'Calculator', sub: 'Margin, liquidation and PnL before you trade', icon: <Calculator className="h-4 w-4" /> },
  { kind: 'tape', title: 'Live tape', sub: 'Big trades and liquidations as they happen', icon: <Radio className="h-4 w-4" /> },
  { kind: 'funding', title: 'Funding', sub: 'Every market’s rate, APR and next payment', icon: <Percent className="h-4 w-4" /> },
];

/** Open a tool with sensible starting markets. */
export function openTool(kind: ToolKind) {
  if (kind === 'pair') dock.openTool('pair', { coin: 'BTC', coin2: 'ETH' });
  else if (kind === 'calc') dock.openTool('calc', { coin: 'BTC' });
  else dock.openTool(kind);
}

/** Short name for the dock's hover label. */
export function toolDockName(w: Win): string {
  if (w.kind === 'wallet' && w.address) return formatAddress(w.address);
  return toolTitle(w);
}

export function toolTitle(w: Win): string {
  switch (w.kind) {
    case 'wallet': return w.address ? `Watch · ${formatAddress(w.address)}` : 'Wallet watch';
    case 'pair': return `${w.coin}/${w.coin2}`;
    case 'calc': return `Calculator · ${w.coin}`;
    case 'tape': return 'Live tape';
    case 'funding': return 'Funding';
    default: return '';
  }
}

export function toolIcon(w: Win, size = 15): ReactNode {
  if (w.kind === 'pair' || w.kind === 'calc') return <CoinIcon symbol={w.coin ?? 'BTC'} size={size} className="shrink-0" />;
  // A watched wallet shows its own avatar (the eye only until one is picked).
  if (w.kind === 'wallet' && w.address) return <BulkAvatar seed={w.address} size={size} className="!rounded-[30%]" />;
  const item = TOOL_MENU.find((t) => t.kind === w.kind);
  return <span className="text-[var(--text-secondary)] [&>svg]:h-3.5 [&>svg]:w-3.5">{item?.icon}</span>;
}

/** The body of a tool window. `patch` changes what it shows (here, or in a popped-out copy). */
export function ToolBody({ win, patch, onInterval }: {
  win: Win; patch: (p: Partial<Pick<Win, 'coin' | 'coin2' | 'address'>>) => void; onInterval: (v: string) => void;
}) {
  switch (win.kind) {
    case 'wallet': return <WalletWatch address={win.address || undefined} onAddress={(a) => patch({ address: a })} />;
    case 'pair': return <PairChart coin={win.coin ?? 'BTC'} coin2={win.coin2 ?? 'ETH'} interval={win.interval} onInterval={onInterval} onChange={(a, b) => patch({ coin: a, coin2: b })} />;
    case 'calc': return <CalcView coin={win.coin ?? 'BTC'} onCoin={(c) => patch({ coin: c })} />;
    case 'tape': return <TapeView />;
    case 'funding': return <FundingBoard />;
    default: return null;
  }
}
