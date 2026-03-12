import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:3002/api/:path*' },
      { source: '/ws', destination: 'http://localhost:3002/ws' },
    ];
  },
};

export default nextConfig;
