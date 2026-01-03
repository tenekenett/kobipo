/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions are available by default in Next.js 14+
  // Skip static generation for client components
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
}

module.exports = nextConfig

