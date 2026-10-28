import type { NextConfig } from 'next';

// The public site is the original static HTML in /public.
// These rules reproduce the old vercel.json (cleanUrls + rewrites) so every live URL keeps working.
const ALIASES: Record<string, string> = {
  '/': '/index.html',
  '/home': '/index.html',
  '/nil-infrastructure': '/article_pillar1_NIL_Infrastructure.html',
  '/nil-compliance': '/article_pillar2_NIL_Compliance.html',
  '/revenue-sharing': '/article_pillar3_Revenue_Sharing.html',
  '/nil-recruiting': '/article_pillar4_NIL_Recruiting.html',
  '/business-entity': '/article_pillar5_Business_Entity.html',
  '/non-revenue-sports': '/article_pillar6_NonRevenue_Sports.html',
  '/financial-literacy': '/article_pillar7_Financial_Literacy.html',
  '/transfer-portal': '/article_pillar8_Transfer_Portal.html',
};

const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: true },
      { source: '/:page([A-Za-z0-9_-]+)\\.html', destination: '/:page', permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: Object.entries(ALIASES).map(([source, destination]) => ({ source, destination })),
      afterFiles: [],
      // Any other clean path falls back to its .html page in /public.
      fallback: [{ source: '/:page([A-Za-z0-9_-]+)', destination: '/:page.html' }],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
