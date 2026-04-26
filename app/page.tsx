"use client"

import Link from "next/link"
import { Logo } from "@/components/ui/Logo"

export default function Home() {
  return (
    <div className="min-h-screen bg-kobipo-offwhite">
      <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-kobipo-border bg-white px-6">
        <Logo variant="light" size="sm" href="/" />
        <div className="flex items-center gap-2">
          <Link href="/signin" className="rounded-lg border border-kobipo-blue px-4 py-2 text-sm font-semibold text-kobipo-blue transition-colors hover:bg-kobipo-pale">
            Giriş Yap
          </Link>
          <Link href="/signup" className="rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-kobipo-mid">
            Ücretsiz Başla
          </Link>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-kobipo-navy px-6 py-20">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-kobipo-blue opacity-30"
          style={{ clipPath: "polygon(15% 0, 100% 0, 100% 100%, 0 100%)" }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-kobipo-mid opacity-15"
          style={{ clipPath: "polygon(30% 0, 100% 0, 100% 100%, 0 100%)" }}
        />

        <div className="relative z-10 max-w-xl">
          <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-kobipo-green/30 bg-kobipo-green/15 px-3 py-1 text-[11px] font-semibold tracking-wide text-kobipo-green">
            <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />
            KOBİ Proje Ofisi
          </span>

          <h1 className="mb-4 text-4xl font-extrabold leading-tight tracking-tight text-white">
            İşletmenizi dijitalleştirin, <span className="text-kobipo-green">rakamlarınızı</span> netleştirin.
          </h1>

          <p className="mb-3 text-sm font-bold italic text-white/50">
            <strong className="not-italic text-white">Az laf,</strong> doğru rakam.
          </p>

          <p className="mb-8 max-w-md text-sm leading-relaxed text-white/60">
            Cari hesaplar, stok takibi, e-fatura ve finansal raporlarınızı tek platformda yönetin.
            Bulut tabanlı, güvenli, kolay.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-kobipo-green px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-kobipo-green-dark">
              Ücretsiz Başla
            </Link>
            <button className="rounded-xl border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
              Demo İzle
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-5">
            {["Kredi kartı gerekmez", "İlk 30 gün ücretsiz", "SSL güvenli"].map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-kobipo-green/25">
                  <svg width="7" height="7" viewBox="0 0 8 8">
                    <path
                      d="M1 4l2 2 4-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
