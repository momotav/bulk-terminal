'use client';

import { useState, useEffect } from 'react';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { analytics, formatCompact, cn } from '@/lib/api';
import { Percent } from 'lucide-react';

// Fee Tier Card
const FeeTierCard = ({ tier, isActive }: { tier: { thresholdVolume: number; makerBps: number; takerBps: number }; isActive?: boolean }) => (
  <div className={cn(
    "p-3 rounded-lg border transition-all",
    isActive 
      ? "bg-[var(--accent-muted)] border-[var(--accent-primary)]" 
      : "bg-[var(--bg-muted)] border-[var(--border-color)]"
  )}>
    <p className="text-xs text-[var(--text-tertiary)] mb-1">
      {tier.thresholdVolume === 0 ? 'Base Tier' : `≥ $${formatCompact(tier.thresholdVolume)}`}
    </p>
    <div className="flex justify-between items-center">
      <div>
        <p className="text-xs text-[var(--text-tertiary)]">Maker</p>
        <p className={cn("text-sm font-medium", tier.makerBps <= 0 ? "text-[var(--pos)]" : "text-[var(--text-primary)]")}>
          {tier.makerBps <= 0 ? `${tier.makerBps}` : tier.makerBps} bps
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-[var(--text-tertiary)]">Taker</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">{tier.takerBps} bps</p>
      </div>
    </div>
  </div>
);

export function FeeTiersWidget() {
  const { network } = useCurrentNetwork();
  const [feeTiers, setFeeTiers] = useState<{
    tiers: { thresholdVolume: number; makerBps: number; takerBps: number }[];
    totalProtocolSettlement: number;
    settledFills: number;
  } | null>(null);

  useEffect(() => {
    const fetchFees = async () => {
      try {
        const data = await analytics.getFeeTiers();
        setFeeTiers(data);
      } catch (error) {
        console.error('Failed to fetch fees:', error);
      }
    };
    fetchFees();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchFees, 300000);
    return () => clearInterval(interval);
  }, [network]);

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Percent className="w-5 h-5 text-[var(--accent-primary)]" />
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Fee Tiers</h3>
      </div>
      
      {feeTiers ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {feeTiers.tiers.slice(0, 8).map((tier, i) => (
              <FeeTierCard key={i} tier={tier} isActive={i === 0} />
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-tertiary)]">Total Settled Fills</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {feeTiers.settledFills.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-sm text-[var(--text-tertiary)]">Protocol Revenue</span>
              <span className="text-sm font-medium text-[var(--pos)]">
                ${formatCompact(feeTiers.totalProtocolSettlement)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-[200px] flex items-center justify-center text-[var(--text-tertiary)]">
          Loading fee data...
        </div>
      )}
    </div>
  );
}

export default FeeTiersWidget;
