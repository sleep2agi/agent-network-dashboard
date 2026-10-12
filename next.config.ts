import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev "N" badge sits on the bottom edge and collides with the
  // mobile tab bar. Keep it in the top-right corner instead.
  devIndicators: { position: 'top-right' },
};

export default nextConfig;
