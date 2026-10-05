// Shared animated-logo loader. The SVG at /logo-loader.svg carries its own
// cycled animation, so this is just a sized <img>. Used for the page-level
// wallet loader and for in-panel candle loading (observe page + chart modal).
interface Props {
  /** Tailwind height class, e.g. "h-20" (page) or "h-12" (in-panel). */
  sizeClass?: string;
  /** Optional caption under the mark (uppercase, letter-spaced). */
  label?: string;
  className?: string;
}

export function LogoLoader({ sizeClass = 'h-12', label, className }: Props) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-loader.svg" alt="Loading" className={`${sizeClass} w-auto select-none`} />
      {label && (
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-[var(--role-content-subtle)] animate-pulse">
          {label}
        </p>
      )}
    </div>
  );
}
