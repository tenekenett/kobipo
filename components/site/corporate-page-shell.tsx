import Link from "next/link"
import type { ReactNode } from "react"

type CorporatePageShellProps = {
  badge?: string
  title: string
  description: string
  children: ReactNode
  cta?: {
    title: string
    description: string
    primaryLabel: string
    primaryHref: string
    secondaryLabel?: string
    secondaryHref?: string
  }
}

export function CorporatePageShell({ badge = "Kurumsal", title, description, children, cta }: CorporatePageShellProps) {
  return (
    <div className="min-h-screen bg-kobipo-offwhite text-kobipo-text">
      <header className="sticky top-0 z-40 border-b border-kobipo-border bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <svg width="34" height="34" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <defs>
                <clipPath id="corporate-nav-clip">
                  <rect width="36" height="36" rx="9" />
                </clipPath>
              </defs>
              <rect width="36" height="36" rx="9" className="fill-kobipo-blue" />
              <polygon points="0,36 36,0 36,36" className="fill-kobipo-navy" clipPath="url(#corporate-nav-clip)" />
              <path d="M5,22 A13,13 0 1,1 31,22" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
              <path d="M29,14 L31,22 L25,20" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="18" cy="25" r="4.5" className="fill-kobipo-green" />
            </svg>
            <div className="leading-none">
              <div className="text-xl font-extrabold tracking-tight text-kobipo-navy">
                kobi<span className="font-light text-kobipo-blue">po</span>
              </div>
              <div className="mt-0.5 text-[9px] font-bold italic tracking-wide text-kobipo-green-dark">Az laf, doğru rakam.</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/kurumsal/hakkimizda" className="text-sm font-medium text-kobipo-gray transition-colors hover:text-kobipo-blue">
              Hakkımızda
            </Link>
            <Link href="/kurumsal/blog" className="text-sm font-medium text-kobipo-gray transition-colors hover:text-kobipo-blue">
              Blog
            </Link>
            <Link href="/kurumsal/destek" className="text-sm font-medium text-kobipo-gray transition-colors hover:text-kobipo-blue">
              Destek
            </Link>
            <Link href="/kurumsal/iletisim" className="text-sm font-medium text-kobipo-gray transition-colors hover:text-kobipo-blue">
              İletişim
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/signin"
              className="rounded-lg border border-kobipo-border px-3 py-2 text-xs font-semibold text-kobipo-navy transition-colors hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue sm:px-4 sm:text-sm"
            >
              Giriş Yap
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-kobipo-blue px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-kobipo-mid sm:px-4 sm:text-sm"
            >
              Ücretsiz Başla
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-kobipo-border bg-kobipo-navy px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-kobipo-green/35 bg-kobipo-green/15 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-kobipo-green">
            <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />
            {badge}
          </div>

          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">{description}</p>

          <nav className="mt-6 flex items-center gap-2 text-xs text-white/50">
            <Link href="/" className="transition-colors hover:text-white">
              Ana Sayfa
            </Link>
            <span>/</span>
            <span className="text-white/80">Kurumsal</span>
          </nav>
        </div>
      </section>

      <main className="px-6 py-14 sm:py-16">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      {cta && (
        <section className="px-6 pb-16">
          <div className="mx-auto max-w-5xl rounded-3xl bg-kobipo-navy px-8 py-10 sm:px-10">
            <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1.4fr_1fr]">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-white">{cta.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{cta.description}</p>
              </div>
              <div className="flex flex-col gap-2.5">
                <Link
                  href={cta.primaryHref}
                  className="rounded-xl bg-kobipo-green px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-kobipo-green-dark"
                >
                  {cta.primaryLabel}
                </Link>
                {cta.secondaryLabel && cta.secondaryHref ? (
                  <Link
                    href={cta.secondaryHref}
                    className="rounded-xl border border-white/25 px-5 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    {cta.secondaryLabel}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      <footer className="bg-kobipo-text px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
            <div className="col-span-2">
              <div className="mb-4 flex items-center gap-2.5">
                <svg width="32" height="32" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <defs>
                    <clipPath id="corporate-footer-clip">
                      <rect width="36" height="36" rx="9" />
                    </clipPath>
                  </defs>
                  <rect width="36" height="36" rx="9" className="fill-kobipo-blue" />
                  <polygon points="0,36 36,0 36,36" className="fill-kobipo-navy" clipPath="url(#corporate-footer-clip)" />
                  <path d="M5,22 A13,13 0 1,1 31,22" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
                  <path d="M29,14 L31,22 L25,20" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="18" cy="25" r="4.5" className="fill-kobipo-green" />
                </svg>
                <div className="text-lg font-extrabold tracking-tight text-white">
                  kobi<span className="font-light text-kobipo-light">po</span>
                </div>
              </div>
              <div className="mb-3 text-[11px] font-bold italic text-kobipo-green">Az laf, doğru rakam.</div>
              <p className="max-w-xs text-xs leading-relaxed text-white/45">
                KOBİ&apos;lerin dijital muhasebe ve işletme yönetim platformu. Bulut tabanlı, güvenli ve kullanımı kolay.
              </p>
            </div>

            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Şirket</div>
              <div className="space-y-2.5">
                <Link href="/kurumsal/hakkimizda" className="block text-xs text-white/55 transition-colors hover:text-white">Hakkımızda</Link>
                <Link href="/kurumsal/blog" className="block text-xs text-white/55 transition-colors hover:text-white">Blog</Link>
                <Link href="/kurumsal/kariyer" className="block text-xs text-white/55 transition-colors hover:text-white">Kariyer</Link>
              </div>
            </div>

            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Yasal</div>
              <div className="space-y-2.5">
                <Link href="/kurumsal/gizlilik" className="block text-xs text-white/55 transition-colors hover:text-white">Gizlilik</Link>
                <Link href="/kurumsal/kvkk" className="block text-xs text-white/55 transition-colors hover:text-white">KVKK</Link>
                <Link href="/kurumsal/cerezler" className="block text-xs text-white/55 transition-colors hover:text-white">Çerezler</Link>
                <Link href="/kurumsal/kullanim-kosullari" className="block text-xs text-white/55 transition-colors hover:text-white">Kullanım Koşulları</Link>
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-white/10 pt-6 text-[11px] text-white/35">
            © {new Date().getFullYear()} Kobipo. Tüm hakları saklıdır.
          </div>
        </div>
      </footer>
    </div>
  )
}
