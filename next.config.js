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
  //
  // pdfmake da harici: CommonJS ve fontlarını çalışma anında fs ile okuyor;
  // sunucu paketine gömülürse font yolları bozuluyor.
  serverExternalPackages: ["@prisma/client", "prisma", "pdfmake"],
  // Bundled örnek XSLT şablonları çalışma anında fs ile okunuyor; Vercel'in
  // serverless fonksiyon paketine dahil edilmeleri için trace'e ekliyoruz.
  outputFileTracingIncludes: {
    "/api/e-donusum/templates/**": ["./lib/integrations/e-invoice/sample-templates/**"],
    // PDF fontları fs ile okunuyor (lib/pdf/doc/font.ts); Next'in izleyicisi
    // dinamik yolu göremediği için fonksiyon paketine açıkça eklenir.
    "/api/**": ["./node_modules/dejavu-fonts-ttf/ttf/**", "./public/fonts/**"],
  },
  env: {
    ...(!nextAuthUrl && vercelUrl ? { NEXTAUTH_URL: `https://${vercelUrl}` } : {}),
  },
}

module.exports = nextConfig

