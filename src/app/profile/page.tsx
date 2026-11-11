'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wallet, ExternalLink, Copy, Check, Loader2, Mail, UserCheck, ArrowRight, Search, User } from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useStore, FollowedWallet } from '@/store';
import { userApi, wallet as walletApi, type WalletData, type ClosedPosition } from '@/lib/api';
import { trackRecord } from '@/lib/walletMetrics';
import { money, pnlColor, signed } from '@/lib/walletFormat';
import { hiResAvatar } from '@/lib/avatar';

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const short = (a: string, n = 6) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : '');

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)]">
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-medium text-[var(--role-content)]">{title}</h2>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, color, loading }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; loading?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--role-surface-raised)] px-4 py-3.5">
      <div className="text-[13px] text-[var(--role-content-muted)]">{label}</div>
      {loading ? (
        <div className="mt-2 h-6 w-24 rounded-md bg-[var(--role-surface-raised)] animate-pulse" />
      ) : (
        <div className="mt-1.5 text-[22px] leading-tight font-medium tabular-nums tracking-tight truncate" style={{ color: color ?? 'var(--role-content)' }}>{value}</div>
      )}
      {sub && !loading && <div className="mt-1 text-[12px] text-[var(--role-content-subtle)] tabular-nums truncate">{sub}</div>}
    </div>
  );
}

function AccountRow({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-t border-[var(--border-color)] first:border-t-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-[var(--role-surface-raised)] flex items-center justify-center text-[var(--role-content)]">{icon}</div>
        <div className="min-w-0">
          <div className="text-[14px] text-[var(--role-content)]">{title}</div>
          <div className="text-[13px] text-[var(--role-content-muted)] truncate">{detail}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

const ghostBtn = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors disabled:opacity-50';

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, following, setFollowing, authToken, claimedWallet, setClaimedWallet } = useStore();
  const { ready, authenticated, linkTwitter, unlinkTwitter, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();

  const [copied, setCopied] = useState(false);
  const [linkingTwitter, setLinkingTwitter] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [unclaimLoading, setUnclaimLoading] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [account, setAccount] = useState<WalletData | null>(null);
  const [closed, setClosed] = useState<ClosedPosition[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const connectedWalletAddress = solanaWallets?.[0]?.address || privyUser?.wallet?.address || '';
  const emailAccount = privyUser?.linkedAccounts?.find((a): a is any => a.type === 'email');
  const userEmail = emailAccount?.address || privyUser?.email?.address || user?.email;
  const isEmailUser = authenticated && !connectedWalletAddress && !!userEmail;
  const effectiveClaimedWallet = claimedWallet || user?.claimed_wallet;
  const myWallet = connectedWalletAddress || effectiveClaimedWallet || '';

  const twitterAccount = privyUser?.linkedAccounts?.find((a): a is any => a.type === 'twitter_oauth');
  const twitterHandle = twitterAccount?.username || user?.twitter_handle;
  const twitterName = twitterAccount?.name || user?.twitter_name;
  const twitterAvatar = hiResAvatar(twitterAccount?.profilePictureUrl || user?.twitter_avatar);
  const hasTwitter = !!twitterAccount || !!user?.twitter_handle;

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  useEffect(() => { setAvatarFailed(false); }, [twitterAvatar]);

  // Keep the backend's copy of the X profile in step with Privy.
  useEffect(() => {
    if (!twitterAccount || !authToken || user?.twitter_handle) return;
    userApi.linkTwitter(authToken, {
      twitterId: twitterAccount.subject || '',
      twitterHandle: twitterAccount.username || '',
      twitterName: twitterAccount.name || '',
      twitterAvatar: twitterAccount.profilePictureUrl || '',
    }).then((r: any) => { if (r?.user) setUser(r.user); }).catch((e) => console.error('Failed to sync Twitter:', e));
  }, [twitterAccount, authToken, user?.twitter_handle, setUser]);

  useEffect(() => {
    if (!authToken) return;
    setLoadingFollowing(true);
    (userApi.getFollowing(authToken) as Promise<{ following?: FollowedWallet[] }>)
      .then((r) => { if (r?.following) setFollowing(r.following); })
      .catch((e) => console.error('Failed to load following:', e))
      .finally(() => setLoadingFollowing(false));
  }, [authToken, setFollowing]);

  // The same live BULK numbers the wallet page shows, so the two always agree.
  useEffect(() => {
    if (!myWallet) { setAccount(null); setClosed(null); return; }
    let cancelled = false;
    setStatsLoading(true);
    (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        const [w, c] = await Promise.all([
          walletApi.getWallet(myWallet).catch(() => null),
          walletApi.getClosedPositions(myWallet, { limit: 10000 }).catch(() => null),
        ]);
        if (cancelled) return;
        if (w) setAccount(w);
        if (c) setClosed(c.positions || []);
        if (w && c) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      if (!cancelled) setStatsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [myWallet]);

  const margin = account?.live?.margin ?? null;
  const positions = account?.live?.positions ?? [];
  const totalPnl = margin ? margin.realizedPnl + margin.unrealizedPnl : null;
  const accountValue = margin ? margin.totalBalance + margin.unrealizedPnl : null;
  const feeTier = account?.live?.feeTiers?.find((t) => t.symbol === 'global') ?? account?.live?.feeTiers?.[0] ?? null;
  const record = useMemo(() => (closed ? trackRecord(closed) : null), [closed]);

  const copyAddress = () => {
    if (!myWallet) return;
    navigator.clipboard.writeText(myWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleLinkTwitter = async () => {
    if (hasTwitter) return;
    setLinkingTwitter(true);
    try { await linkTwitter(); } catch (e) { console.error('Failed to link Twitter:', e); } finally { setLinkingTwitter(false); }
  };

  const handleUnlinkTwitter = async () => {
    if (!twitterAccount) return;
    try {
      await unlinkTwitter(twitterAccount.subject);
      if (authToken) {
        const r = (await userApi.unlinkTwitter(authToken)) as { user?: any };
        if (r?.user) setUser(r.user);
      }
    } catch (e) { console.error('Failed to unlink Twitter:', e); }
  };

  const handleUnclaimWallet = async () => {
    if (!authToken) return;
    setUnclaimLoading(true);
    try {
      const r = (await userApi.unclaimWallet(authToken)) as { user?: any; success?: boolean };
      if (r?.success) { setClaimedWallet(null); if (r.user) setUser(r.user); }
    } catch (e) { console.error('Failed to unclaim wallet:', e); } finally { setUnclaimLoading(false); }
  };

  const openSearch = () => window.dispatchEvent(new Event('bulkstats:open-command'));

  if (!ready || !authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-7 h-7 text-[var(--role-content-subtle)] animate-spin" />
      </div>
    );
  }

  const displayName = twitterName || user?.display_name || userEmail || 'Anonymous trader';
  const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const initial = (displayName.trim()[0] || '?').toUpperCase();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col gap-5">
      {/* ── Identity ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="relative shrink-0">
            {twitterAvatar && !avatarFailed ? (
              <img src={twitterAvatar} alt="" width={88} height={88} onError={() => setAvatarFailed(true)}
                className="w-[88px] h-[88px] rounded-2xl object-cover ring-1 ring-[var(--border-color)]" />
            ) : (
              <div className="w-[88px] h-[88px] rounded-2xl bg-[var(--role-surface-raised)] ring-1 ring-[var(--border-color)] flex items-center justify-center text-[34px] font-medium text-[var(--role-content-muted)]">
                {twitterName || user?.display_name ? initial : userEmail ? <Mail className="w-9 h-9" /> : <User className="w-9 h-9" />}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] sm:text-[30px] leading-tight font-medium tracking-tight text-[var(--role-content)] truncate">{displayName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[var(--role-content-muted)]">
              {twitterHandle && (
                <a href={`https://x.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-[var(--role-content)] transition-colors">
                  <XIcon className="w-3.5 h-3.5" />@{twitterHandle}
                </a>
              )}
              {myWallet && (
                <button onClick={copyAddress} title="Copy address" className="inline-flex items-center gap-1.5 font-mono hover:text-[var(--role-content)] transition-colors">
                  {short(myWallet)}
                  {copied ? <Check className="w-3.5 h-3.5 text-[var(--pos)]" /> : <Copy className="w-3.5 h-3.5 opacity-70" />}
                </button>
              )}
              {memberSince && <span>Member since {memberSince}</span>}
            </div>
          </div>

          {myWallet ? (
            <Link href={`/wallet/${myWallet}`} className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-[14px] font-medium bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110 transition">
              Open my wallet <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <button onClick={openSearch} className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-[14px] font-medium bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110 transition">
              <Search className="w-4 h-4" /> Find my wallet
            </button>
          )}
        </div>

        {/* ── Live trading numbers ─────────────────────────────── */}
        {myWallet ? (
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Stat label="Total PnL" loading={statsLoading && !margin}
              value={totalPnl === null ? '—' : signed(totalPnl)}
              color={totalPnl === null ? undefined : pnlColor(totalPnl)}
              sub={margin ? `${signed(margin.realizedPnl)} realized · ${signed(margin.unrealizedPnl)} open` : undefined} />
            <Stat label="Account value" loading={statsLoading && !margin}
              value={accountValue === null ? '—' : money(accountValue)}
              sub={positions.length ? `${positions.length} open position${positions.length === 1 ? '' : 's'}` : 'No open positions'} />
            <Stat label={`Volume (${feeTier?.windowDays ?? 14}d)`} loading={statsLoading && !account}
              value={feeTier ? money(feeTier.rollingVolume) : '—'}
              sub={feeTier ? `${feeTier.takerBps} / ${feeTier.makerBps} bps taker / maker` : undefined} />
            <Stat label="Win rate" loading={statsLoading && closed === null}
              value={record ? `${(record.winRate * 100).toFixed(1)}%` : '—'}
              sub={record ? `${record.wins} of ${record.count} closed trades` : closed ? 'No closed trades yet' : undefined} />
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-4 text-[13px] text-[var(--role-content-muted)]">
            You signed in with email, so there&apos;s no wallet linked yet. Search for your address, open it, and press <span className="text-[var(--role-content)]">This is my wallet</span> to claim it. Your stats will show up here.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── Connected accounts ─────────────────────────────────── */}
        <Panel title="Connected accounts">
          <AccountRow
            icon={<XIcon className="w-4 h-4" />}
            title="X"
            detail={hasTwitter ? `@${twitterHandle}` : 'Not connected'}
            action={hasTwitter ? (
              <button onClick={handleUnlinkTwitter} className={`${ghostBtn} hover:!text-[var(--neg)]`}>Disconnect</button>
            ) : (
              <button onClick={handleLinkTwitter} disabled={linkingTwitter} className={ghostBtn}>
                {linkingTwitter ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XIcon className="w-3.5 h-3.5" />}Connect
              </button>
            )}
          />
          {connectedWalletAddress && (
            <AccountRow icon={<Wallet className="w-4 h-4" />} title="Solana wallet"
              detail={<span className="font-mono">{short(connectedWalletAddress, 8)}</span>}
              action={<span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content-muted)]"><Check className="w-3.5 h-3.5 text-[var(--pos)]" />Connected</span>} />
          )}
          {effectiveClaimedWallet && (
            <AccountRow icon={<UserCheck className="w-4 h-4" />} title="Claimed wallet"
              detail={<span className="font-mono">{short(effectiveClaimedWallet, 8)}</span>}
              action={<button onClick={handleUnclaimWallet} disabled={unclaimLoading} className={`${ghostBtn} hover:!text-[var(--neg)]`}>
                {unclaimLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Unclaim'}
              </button>} />
          )}
          {userEmail && (
            <AccountRow icon={<Mail className="w-4 h-4" />} title="Email" detail={userEmail}
              action={<span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content-muted)]"><Check className="w-3.5 h-3.5 text-[var(--pos)]" />Verified</span>} />
          )}
          {isEmailUser && !effectiveClaimedWallet && (
            <AccountRow icon={<Wallet className="w-4 h-4" />} title="Wallet" detail="No wallet claimed yet"
              action={<button onClick={openSearch} className={ghostBtn}><Search className="w-3.5 h-3.5" />Find</button>} />
          )}
        </Panel>

        {/* ── Following ─────────────────────────────────────────── */}
        <Panel title={`Following${following.length ? ` · ${following.length}` : ''}`}
          action={following.length > 0 ? <Link href="/following" className="text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] transition-colors">View all</Link> : undefined}>
          {loadingFollowing && following.length === 0 ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-[var(--role-surface-raised)] animate-pulse" />)}
            </div>
          ) : following.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[14px] text-[var(--role-content-muted)]">You&apos;re not following any wallets yet.</p>
              <Link href="/leaderboard" className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content)] hover:underline">
                Find traders on the leaderboard <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="flex flex-col">
              {following.slice(0, 6).map((w) => (
                <Link key={w.wallet_address} href={`/wallet/${w.wallet_address}`}
                  className="group flex items-center justify-between gap-3 py-2.5 border-t border-[var(--border-color)] first:border-t-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-[var(--role-surface-raised)] flex items-center justify-center">
                      <Wallet className="w-3.5 h-3.5 text-[var(--role-content-subtle)]" />
                    </div>
                    <span className="text-[14px] text-[var(--role-content)] truncate group-hover:underline">
                      {w.nickname || <span className="font-mono">{short(w.wallet_address, 5)}</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {w.total_pnl !== undefined && w.total_pnl !== null && (
                      <span className="text-[13px] tabular-nums" style={{ color: pnlColor(Number(w.total_pnl)) }}>{signed(Number(w.total_pnl))}</span>
                    )}
                    <ExternalLink className="w-3.5 h-3.5 text-[var(--role-content-subtle)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
