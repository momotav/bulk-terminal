import { permanentRedirect } from 'next/navigation';

// The Whale Tracker page was retired; the leaderboard covers the largest accounts and
// the header search (⌘K) finds any wallet or @handle.
export default function OldWhaleTracker() {
  permanentRedirect('/leaderboard');
}
