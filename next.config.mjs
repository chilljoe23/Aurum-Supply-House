/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // puppeteer-core is only ever imported (dynamically) by the server-side PDF
  // routes. Keep it external so Next never tries to bundle Chromium tooling into
  // any client or server build.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // Chromium's compressed binaries are loaded dynamically at runtime, so Next's
  // automatic file tracer cannot discover them. Include them in every PDF route
  // function bundle explicitly for Vercel.
  outputFileTracingIncludes: {
    "/orders/**/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/quotes/**/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/purchasing/**/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/commissions/statements/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
