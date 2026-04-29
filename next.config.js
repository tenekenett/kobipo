/** @type {import('next').NextConfig} */
// Vercel sets VERCEL_URL at build time; NextAuth needs NEXTAUTH_URL in production when not set in dashboard.
const vercelUrl = process.env.VERCEL_URL
const nextAuthUrl = process.env.NEXTAUTH_URL

const nextConfig = {
  // Server Actions are available by default in Next.js 16+
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  // Keep Prisma engine outside of the server bundler so it cold-starts faster.
  serverExternalPackages: ["@prisma/client", "prisma"],
  env: {
    ...(!nextAuthUrl && vercelUrl ? { NEXTAUTH_URL: `https://${vercelUrl}` } : {}),
  },
}

module.exports = nextConfig

