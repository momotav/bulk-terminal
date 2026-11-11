import { permanentRedirect } from 'next/navigation';

// Wallet pages moved from /whales/<address> to /wallet/<address>. Old shared links
// keep working: send them to the new address with their query string intact.
export default function OldWalletRoute({
  params,
  searchParams,
}: {
  params: { address: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.set(k, v);
  }
  const q = qs.toString();
  permanentRedirect(`/wallet/${encodeURIComponent(params.address)}${q ? `?${q}` : ''}`);
}
