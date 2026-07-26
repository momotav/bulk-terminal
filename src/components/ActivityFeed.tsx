'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  FolderPlus,
  FolderMinus,
  Pencil,
  ShieldCheck,
  FileSignature,
  Loader2,
  Activity as ActivityIcon,
  AlertCircle,
} from 'lucide-react';
import { wallet, formatNumber, formatAddress, type ActivityEvent, type ActivityResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// ActivityFeed
//
// Timeline of protocol-level events for a wallet (deposits, withdrawals,
// transfers, sub-account create/remove/rename, multisig proposals).
//
// Backed by GET /api/wallet/:address/activity which proxies BULK's
// `activityHistory` query and adds resolver-friendly labels for sub-account
// addresses. Cached 30s on the backend.
//
// Design choices:
//
//  - We render the same component regardless of how many events exist; for
//    a fresh wallet that's just one row ("Deposited 10,000 USDC"). This is
//    intentional — even a single event is informative, and the empty state
//    would otherwise just say "nothing here yet" which adds no value.
//
//  - Each event type gets its own icon + verb so the timeline reads like a
//    sentence: "[icon] alice deposited 10,000 USDC, 2 days ago". The icons
//    come from lucide-react and are color-coded (deposits green, transfers
//    neutral, removals red).
//
//  - Counterparties get smart labels. If `from` or `to` is a sub-account,
//    the backend resolver substitutes "farm (8cbN…oFFN's sub-account)"
//    instead of the off-curve pubkey. Vanilla wallets show as a shortened
//    address with no extra context — clean.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

interface VerbAndIcon {
  verb: string;
  Icon: React.ComponentType<{ className?: string }>;
  // Tailwind text color class for the icon. Kept as a string to align with
  // how the rest of the codebase styles icons.
  color: string;
}

// Map BULK's activityType strings to display attributes. Falls back to a
// generic "activity" entry for unknown future event types so the timeline
// keeps rendering when BULK adds new ones.
function describeEvent(activityType: string, isOutgoing: boolean): VerbAndIcon {
  switch (activityType) {
    case 'deposit':
      return { verb: 'Deposited', Icon: ArrowDownToLine, color: 'text-bulk-green' };
    case 'withdrawal':
      return { verb: 'Withdrew', Icon: ArrowUpFromLine, color: 'text-bulk-red' };
    case 'transfer':
      return {
        verb: isOutgoing ? 'Transferred out' : 'Received',
        Icon: ArrowLeftRight,
        color: isOutgoing ? 'text-bulk-red' : 'text-bulk-green',
      };
    case 'createSubAccount':
      return { verb: 'Created sub-account', Icon: FolderPlus, color: 'text-bulk-green' };
    case 'removeSubAccount':
      return { verb: 'Removed sub-account', Icon: FolderMinus, color: 'text-bulk-red' };
    case 'renameSubAccount':
      return { verb: 'Renamed sub-account', Icon: Pencil, color: 'text-[var(--text-secondary)]' };
    case 'multisigCreated':
      return { verb: 'Created multisig', Icon: ShieldCheck, color: 'text-bulk-blue' };
    case 'proposalCreated':
      return { verb: 'Proposed multisig action', Icon: FileSignature, color: 'text-bulk-blue' };
    case 'proposalExecuted':
      return { verb: 'Executed multisig proposal', Icon: ShieldCheck, color: 'text-bulk-green' };
    case 'proposalFailed':
      return { verb: 'Multisig proposal failed', Icon: AlertCircle, color: 'text-bulk-red' };
    case 'proposalCancelled':
      return { verb: 'Cancelled multisig proposal', Icon: FileSignature, color: 'text-[var(--text-secondary)]' };
    default:
      // Forward-compatible: unknown event types render with the title-cased
      // event name as the verb and a neutral icon.
      return {
        verb: titleCase(activityType),
        Icon: ActivityIcon,
        color: 'text-[var(--text-secondary)]',
      };
  }
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Format a timestamp into a relative display string (e.g. "2h ago",
// "3 days ago"). BULK uses nanoseconds, JS uses milliseconds — divide by 1e6.
function relativeTime(nanoTs: number): string {
  const ms = Math.floor(nanoTs / 1_000_000);
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

// Pretty-print a counterparty: prefer the resolver-supplied label, otherwise
// shorten the pubkey. Returns null for the system program (deposits' from
// field) since "from system program" is noise — for a deposit the user only
// cares about the amount.
function counterpartyDisplay(addr: string | undefined, label: string | undefined): string | null {
  if (!addr) return null;
  if (addr === '11111111111111111111111111111111') return null;
  return label ?? formatAddress(addr);
}

export function ActivityFeed({ address }: { address: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    wallet
      .getActivity(address, PAGE_SIZE)
      .then((res: ActivityResponse) => {
        if (cancelled) return;
        setEvents(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[ActivityFeed] fetch failed:', err);
        setError('Could not load activity');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
      <div className="p-4 border-b border-[var(--border-color)]">
        <h2 className="font-semibold flex items-center gap-2">
          <ActivityIcon className="w-4 h-4 text-bulk-green" />
          Activity
          {events.length > 0 && (
            <span className="text-xs text-[var(--text-tertiary)] font-normal">
              ({events.length})
            </span>
          )}
        </h2>
      </div>

      {loading ? (
        <div className="p-6 flex items-center gap-2 text-[var(--text-tertiary)] text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading activity…
        </div>
      ) : error ? (
        <div className="p-6 text-sm text-[var(--text-tertiary)]">{error}</div>
      ) : events.length === 0 ? (
        <div className="p-6 text-sm text-[var(--text-tertiary)]">
          No activity yet. Deposits, withdrawals, transfers, and sub-account
          events will appear here.
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-color)]/40 max-h-[400px] overflow-y-auto">
          {events.map((e, i) => (
            <ActivityRow key={`${e.timestamp}-${i}`} event={e} viewerAddress={address} />
          ))}
        </div>
      )}
    </div>
  );
}

// One row in the timeline. Pulled out so the parent stays compact and the
// row layout is easy to tweak independently.
function ActivityRow({ event, viewerAddress }: { event: ActivityEvent; viewerAddress: string }) {
  // Outgoing = the viewer is the source. Affects verb wording for transfers.
  const isOutgoing = event.from === viewerAddress;
  const { verb, Icon, color } = describeEvent(event.activityType, isOutgoing);

  // Build the counterparty line. For transfers we show "to <X>" or "from
  // <X>"; for deposits we show neither (system program is suppressed); for
  // sub-account events we don't render a counterparty either (the operation
  // is on the sub-account itself, identified inline).
  let counterpartyLine: React.ReactNode = null;
  if (event.activityType === 'transfer' || event.activityType === 'withdrawal') {
    const display = counterpartyDisplay(event.to, event.toLabel);
    if (display) {
      counterpartyLine = (
        <span className="text-[var(--text-tertiary)]">
          {' to '}
          <span className="text-[var(--text-secondary)]">{display}</span>
        </span>
      );
    }
  } else if (event.activityType === 'deposit') {
    // For deposits we deliberately don't show "from system program".
    counterpartyLine = null;
  }

  // Amount + symbol when applicable.
  const amountLine =
    event.amount !== undefined && event.symbol ? (
      <span className="font-mono text-[var(--text-primary)]">
        {formatNumber(event.amount, 2)} {event.symbol}
      </span>
    ) : null;

  return (
    <div className="p-3 flex items-start gap-3 hover:bg-[var(--bg-secondary-20)]/30 transition-colors">
      <Icon className={`w-4 h-4 mt-1 flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[var(--text-primary)] font-medium">{verb}</span>
          {amountLine}
          {counterpartyLine}
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-0.5 flex items-center gap-2">
          <span>{relativeTime(event.timestamp)}</span>
          {event.status && event.status !== 'completed' && (
            <span className="px-1.5 py-0.5 rounded bg-bulk-red/10 text-bulk-red text-[10px] uppercase tracking-wider">
              {event.status}
            </span>
          )}
          {event.iso && (
            <span className="px-1.5 py-0.5 rounded bg-bulk-blue/10 text-bulk-blue text-[10px] uppercase tracking-wider">
              isolated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
