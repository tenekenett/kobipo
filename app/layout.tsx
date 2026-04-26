import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { SessionProvider } from '@/components/providers/session-provider'

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
        <SessionProvider>
          {children}
        </SessionProvider>
        <Toaster />
      </body>
    </html>
  )
}
