'use client';

import { useState, useEffect } from 'react';
import { UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useStore } from '@/store';
import { userApi } from '@/lib/api';

interface FollowButtonProps {
  walletAddress: string;
  className?: string;
}

export function FollowButton({ walletAddress, className }: FollowButtonProps) {
  const { ready, authenticated, login } = usePrivy();
  const { authToken, following, addFollowing, removeFollowing, user } = useStore();
  
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const followed = following.some(w => w.wallet_address === walletAddress);
    setIsFollowing(followed);
  }, [following, walletAddress]);

  // Don't show for own wallet
  if (user?.wallet_address === walletAddress) {
    return null;
  }

  const handleClick = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!authToken) return;

    setLoading(true);
    try {
      if (isFollowing) {
        await userApi.unfollowWallet(authToken, walletAddress);
        removeFollowing(walletAddress);
        setIsFollowing(false);
      } else {
        const response = await userApi.followWallet(authToken, walletAddress);
        if (response.follow) {
          addFollowing({
            wallet_address: walletAddress,
            followed_at: new Date().toISOString(),
          });
          setIsFollowing(true);
        }
      }
    } catch (error) {
      console.error('Follow/unfollow error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-all ${
        isFollowing
          ? "border border-dark-border bg-dark-secondary text-text-secondary hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
          : "bg-bulk-green text-dark-primary hover:bg-bulk-green/90"
      } ${loading ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isFollowing ? (
        <>
          <UserMinus className="w-4 h-4" />
          <span>Following</span>
        </>
      ) : (
        <>
          <UserPlus className="w-4 h-4" />
          <span>Follow</span>
        </>
      )}
    </button>
  );
}
