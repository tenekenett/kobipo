import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider'
import { SessionProvider } from '@/components/providers/session-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { RouteProgress } from '@/components/ui/route-progress'
import { DARK_ROUTE_PREFIXES } from '@/lib/theme/dark-routes'
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

const themeInitScript = `
(function() {
  try {
    var darkRoutes = ${JSON.stringify(DARK_ROUTE_PREFIXES)};
    var path = window.location.pathname || '';
    var isDarkRoute = darkRoutes.some(function(p) {
      return path === p || path.indexOf(p + '/') === 0;
    });
    if (!isDarkRoute) {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
      return;
    }
    var stored = localStorage.getItem('kobipo-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = stored === 'dark' || (stored !== 'light' && prefersDark) ? 'dark' : 'light';
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <RouteProgress />
          <SessionProvider>
            <ConfirmDialogProvider>
              {children}
            </ConfirmDialogProvider>
          </SessionProvider>
          <Toaster />
        </ThemeProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  )
}
