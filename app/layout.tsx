import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { SessionProvider } from '@/components/providers/session-provider'
import { RouteProgress } from '@/components/ui/route-progress'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: "Kobipo — Az laf, doğru rakam.",
  description:
    "KOBİ'lerin dijital muhasebe ve proje yönetim platformu. Cari hesaplar, stok takibi, e-fatura ve finansal raporlar tek platformda.",
  icons: {
    icon: "/assets/icons/kobipo-favicon-32.svg",
    apple: "/assets/icons/kobipo-ikon-512.svg",
  },
  openGraph: {
    title: "Kobipo — Az laf, doğru rakam.",
    description: "KOBİ'lerin dijital muhasebe platformu.",
    siteName: "Kobipo",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr">
      <body>
        <RouteProgress />
        <SessionProvider>
          {children}
        </SessionProvider>
        <Toaster />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  )
}
