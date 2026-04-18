import { redirect } from 'next/navigation';

// /analytics is not a page — it redirects to the default sub-page, General.
// Using Next.js server-side redirect() keeps the address bar at /analytics/general
// and avoids briefly flashing an empty analytics shell in the browser.
export default function AnalyticsIndexPage() {
  redirect('/analytics/general');
}
