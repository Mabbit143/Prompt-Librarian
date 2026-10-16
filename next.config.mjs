/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Shared core code imports siblings with ".js" extensions (needed for tsx/vitest); map them back to TS for webpack.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
