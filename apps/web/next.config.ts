import type { NextConfig } from 'next';

// Where /api/* is forwarded. Next bakes the rewrite into the build, so a Docker image
// has to be built with API_ORIGIN pointing at the API container (phase 11).
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, so Next has to compile them itself: the
  // frontend package and every contract the browser side may import. The backend-only contracts
  // (entities, seed, changeset) never reach the browser. tools/verify-layout.mjs fails when this
  // list and the graph in tools/architecture.mjs disagree.
  transpilePackages: [
    '@freshrescue/frontend',
    '@freshrescue/contract-errors',
    '@freshrescue/contract-messages',
    '@freshrescue/contract-primitives',
    '@freshrescue/contract-rules',
    '@freshrescue/contract-ui',
    '@freshrescue/contract-views',
  ],

  // The browser only ever talks to port 3000: no cross-origin call, no CORS setup.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
