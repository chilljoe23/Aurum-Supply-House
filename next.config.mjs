/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // puppeteer-core is only ever imported (dynamically) by the server-side PDF
  // routes. Keep it external so Next never tries to bundle Chromium tooling into
  // any client or server build.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;
