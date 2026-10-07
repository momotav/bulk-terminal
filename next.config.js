/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['bulk.trade'],
  },
  // Pin every JS/RSC request to the deployment that served the page. After a
  // new deploy, an already-open tab then fetches ITS build's assets/RSC instead
  // of a mismatched one — which is what surfaced the raw RSC payload. Vercel
  // sets VERCEL_DEPLOYMENT_ID; undefined locally (no-op). Enable "Skew
  // Protection" in the Vercel project settings so these pinned requests are
  // routed to the matching (kept-alive) deployment.
  experimental: {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  },
}

module.exports = nextConfig
