"use client"

import Link from "next/link"
import { useState } from "react"

const navLinks = [
  { label: "Özellikler", href: "#ozellikler" },
  { label: "Fiyatlandırma", href: "#fiyatlandirma" },
  { label: "SSS", href: "#sss" },
  { label: "Destek", href: "/kurumsal/destek" },
]

function BrandMark({ size = 36 }: { size?: number }) {
  const s = size
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <clipPath id={`brand-clip-${s}`}>
          <rect width="36" height="36" rx="9" />
        </clipPath>
      </defs>
      <rect width="36" height="36" rx="9" className="fill-kobipo-blue" />
      <polygon
        points="0,36 36,0 36,36"
        className="fill-kobipo-navy"
        clipPath={`url(#brand-clip-${s})`}
      />
      <path
        d="M5,22 A13,13 0 1,1 31,22"
        fill="none"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <path
        d="M29,14 L31,22 L25,20"
        fill="none"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="25" r="4.5" className="fill-kobipo-green" />
    </svg>
  )
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M5 10.5l3 3 7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FeatureIcon({ name }: { name: "users" | "box" | "doc" | "chart" | "shield" | "bolt" }) {
  const stroke = "currentColor"
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    stroke,
  }
  switch (name) {
    case "users":
      return (
        <svg {...common}>
          <path d="M16 14a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
          <path d="M3 21a7 7 0 0 1 14 0" />
          <path d="M17 11a4 4 0 0 0 4-4 4 4 0 0 0-4-4" />
          <path d="M21 21a6 6 0 0 0-6-6" />
        </svg>
      )
    case "box":
      return (
        <svg {...common}>
          <path d="M3 7l9-4 9 4-9 4-9-4Z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      )
    case "doc":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </svg>
      )
    case "chart":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 15l4-4 3 3 5-6" />
        </svg>
      )
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      )
  }
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-kobipo-offwhite font-sans text-kobipo-text antialiased">
      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 border-b border-kobipo-border bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark size={36} />
            <div className="leading-none">
              <div className="text-xl font-extrabold tracking-tight text-kobipo-navy">
                kobi<span className="font-light text-kobipo-blue">po</span>
              </div>
              <div className="mt-0.5 text-[9px] font-bold italic tracking-wide text-kobipo-green-dark">
                Az laf, doğru rakam.
              </div>
            </div>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-kobipo-gray transition-colors hover:text-kobipo-blue"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <Link
              href="/signin"
              className="rounded-lg border border-kobipo-border px-4 py-2 text-sm font-semibold text-kobipo-navy transition-colors hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue"
            >
              Giriş Yap
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-kobipo-mid"
            >
              Ücretsiz Başla
            </Link>
          </div>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-kobipo-border md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menüyü aç/kapat"
            aria-expanded={menuOpen}
          >
            <span className="sr-only">Menü</span>
            <div className="flex flex-col gap-1.5">
              <span className="block h-0.5 w-5 bg-kobipo-navy" />
              <span className="block h-0.5 w-5 bg-kobipo-navy" />
              <span className="block h-0.5 w-5 bg-kobipo-navy" />
            </div>
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-kobipo-border bg-white px-6 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-kobipo-navy hover:bg-kobipo-pale"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href="/signin"
                  className="w-full rounded-lg border border-kobipo-border py-2.5 text-center text-sm font-semibold text-kobipo-navy"
                >
                  Giriş Yap
                </Link>
                <Link
                  href="/signup"
                  className="w-full rounded-lg bg-kobipo-blue py-2.5 text-center text-sm font-semibold text-white"
                >
                  Ücretsiz Başla
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden bg-kobipo-navy">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-kobipo-blue opacity-30"
          style={{ clipPath: "polygon(18% 0, 100% 0, 100% 100%, 0 100%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-[38%] bg-kobipo-mid opacity-15"
          style={{ clipPath: "polygon(28% 0, 100% 0, 100% 100%, 0 100%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-1/3 h-72 w-72 rounded-full bg-kobipo-green/20 blur-3xl"
        />

        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
          {/* Sol */}
          <div className="animate-fade-up">
            <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-kobipo-green/30 bg-kobipo-green/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-kobipo-green">
              <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />
              KOBİ Proje Ofisi
            </span>

            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl xl:text-[3.4rem]">
              İşletmenizi dijitalleştirin,
              <br />
              <span className="text-kobipo-green">rakamlarınızı</span> netleştirin.
            </h1>

            <p className="mt-5 text-base font-semibold italic text-white/70">
              <span className="not-italic font-bold text-white">Az laf,</span> doğru rakam.
            </p>

            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/65">
              Cari hesap, stok, e-fatura ve finansal raporları tek panelde yönetin.
              Bulut tabanlı, güvenli ve KOBİ&apos;ler için tasarlanmış sade bir deneyim.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="group inline-flex items-center gap-2 rounded-xl bg-kobipo-green px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-kobipo-green/20 transition-all hover:bg-kobipo-green-dark"
              >
                Ücretsiz Başla
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#ozellikler"
                className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/60 hover:bg-white/10"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7-11-7Z" />
                </svg>
                Özellikleri İncele
              </a>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
              {["Kredi kartı gerekmez", "Tek şube ücretsiz", "SSL güvenli altyapı"].map((t) => (
                <span key={t} className="flex items-center gap-2 text-[12px] font-medium text-white/55">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-kobipo-green/25 text-kobipo-green">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Sağ — Dashboard mockup */}
          <div className="hidden lg:block">
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-kobipo-green/20 to-kobipo-blue/0 blur-2xl" aria-hidden />
              <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl backdrop-blur-md">
                {/* Tarayıcı barı */}
                <div className="mb-2 flex items-center justify-between rounded-xl bg-white px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-kobipo-border" />
                    <span className="h-2.5 w-2.5 rounded-full bg-kobipo-light" />
                    <span className="h-2.5 w-2.5 rounded-full bg-kobipo-green" />
                  </div>
                  <div className="text-[10px] font-semibold text-kobipo-gray">
                    www.kobipo.com
                  </div>
                  <BrandMark size={16} />
                </div>

                {/* Başlık */}
                <div className="mb-2 flex items-center justify-between rounded-xl bg-white px-4 py-3">
                  <div>
                    <div className="text-[11px] font-bold text-kobipo-navy">Genel Bakış</div>
                    <div className="text-[10px] text-kobipo-gray">Nisan 2026 · Aylık özet</div>
                  </div>
                  <div className="rounded-md bg-kobipo-pale px-2 py-1 text-[10px] font-semibold text-kobipo-blue">
                    Canlı
                  </div>
                </div>

                {/* Metrik kartları */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {[
                    { label: "AYLIK CİRO", value: "₺284.500", change: "+12,4%", up: true },
                    { label: "AÇIK FATURA", value: "18", change: "3 gecikmiş", up: false },
                    { label: "AKTİF CARİ", value: "142", change: "+7 yeni", up: true },
                    { label: "DÜŞÜK STOK", value: "5", change: "Kritik seviye", up: false },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-kobipo-border bg-white p-3">
                      <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-kobipo-gray">
                        {m.label}
                      </div>
                      <div className="text-lg font-extrabold leading-none text-kobipo-navy">
                        {m.value}
                      </div>
                      <div
                        className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold ${
                          m.up ? "text-kobipo-green-dark" : "text-kobipo-mid"
                        }`}
                      >
                        <span
                          className={`flex h-3 w-3 items-center justify-center rounded-full ${
                            m.up ? "bg-kobipo-green-light" : "bg-kobipo-pale"
                          }`}
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                            {m.up ? (
                              <path d="M2 5l2-2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            ) : (
                              <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            )}
                          </svg>
                        </span>
                        {m.change}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tablo */}
                <div className="overflow-hidden rounded-xl border border-kobipo-border bg-white">
                  <div className="grid grid-cols-[1.4fr_1fr_0.9fr_1fr] border-b border-kobipo-border bg-kobipo-offwhite px-3 py-2">
                    {["Firma", "Tutar", "Tarih", "Durum"].map((h) => (
                      <div key={h} className="text-[8px] font-bold uppercase tracking-wide text-kobipo-gray">
                        {h}
                      </div>
                    ))}
                  </div>
                  {[
                    { firma: "Yıldız Tic. A.Ş.", tutar: "₺12.400", tarih: "15 Nis", durum: "Ödendi", tone: "text-kobipo-green-dark bg-kobipo-green-light" },
                    { firma: "Arı Gıda Ltd.", tutar: "₺8.750", tarih: "10 Nis", durum: "Bekliyor", tone: "text-kobipo-blue bg-kobipo-pale" },
                    { firma: "Demir Yapı", tutar: "₺31.200", tarih: "2 Nis", durum: "Gecikmiş", tone: "text-kobipo-mid bg-kobipo-light/50" },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1.4fr_1fr_0.9fr_1fr] items-center border-b border-kobipo-border px-3 py-2.5 last:border-0"
                    >
                      <div className="text-[10px] font-semibold text-kobipo-text">{row.firma}</div>
                      <div className="text-[10px] font-medium text-kobipo-text">{row.tutar}</div>
                      <div className="text-[10px] text-kobipo-gray">{row.tarih}</div>
                      <div>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${row.tone}`}>
                          {row.durum}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GÜVEN BANDI */}
      <section className="border-y border-kobipo-border bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 md:grid-cols-4">
          {[
            { num: "3.000+", label: "Aktif işletme" },
            { num: "₺2,1 Mr", label: "Aylık işlem hacmi" },
            { num: "%99,9", label: "Sistem erişilebilirliği" },
            { num: "7/24", label: "Türkçe destek" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-extrabold tracking-tight text-kobipo-navy sm:text-3xl">
                {s.num}
              </div>
              <div className="mt-1 text-xs font-medium text-kobipo-gray">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ÖZELLİKLER */}
      <section id="ozellikler" className="bg-kobipo-offwhite py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="mb-4 inline-block rounded-full bg-kobipo-green-light px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-kobipo-green-dark">
              Özellikler
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">
              İhtiyacınız olan her şey,{" "}
              <span className="text-kobipo-blue">tek platformda</span>
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-kobipo-gray">
              Muhasebeden stoğa, e-faturadan raporlamaya kadar işletmenizin günlük
              akışını tek panelden yönetin.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "users" as const,
                title: "Cari Hesaplar",
                desc:
                  "Müşteri ve tedarikçi bakiyelerini anlık takip edin. Ekstre, ödeme planı ve hatırlatıcılar otomatik.",
                tag: "Toplu içe aktarma",
              },
              {
                icon: "box" as const,
                title: "Stok Yönetimi",
                desc:
                  "Ürün ve hizmet takibi, kritik stok uyarıları, hareket geçmişi ve barkod desteği.",
                tag: "Barkod uyumlu",
              },
              {
                icon: "doc" as const,
                title: "E-Fatura & E-Arşiv",
                desc:
                  "GİB entegrasyonu ile yasal uyumlu e-fatura kesin, imzalayın, gönderin. Süreç tamamen otomatik.",
                tag: "GİB Onaylı",
              },
              {
                icon: "chart" as const,
                title: "Finansal Raporlar",
                desc:
                  "Gelir-gider, KDV, kâr-zarar ve nakit akışı raporları. Excel veya PDF olarak dışa aktarın.",
                tag: "Excel & PDF",
              },
              {
                icon: "shield" as const,
                title: "Güvenli Altyapı",
                desc:
                  "KVKK uyumlu sunucular, SSL şifreleme ve günlük yedekleme. Verileriniz her zaman güvende.",
                tag: "KVKK uyumlu",
              },
              {
                icon: "bolt" as const,
                title: "Hızlı Kurulum",
                desc:
                  "5 dakikada hesabınızı oluşturun, mevcut verilerinizi içe aktarın ve hemen kullanmaya başlayın.",
                tag: "5 dakikada hazır",
              },
            ].map((f) => (
              <article
                key={f.title}
                className="group rounded-2xl border border-kobipo-border bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-kobipo-blue/30 hover:shadow-card"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-kobipo-pale text-kobipo-blue transition-colors group-hover:bg-kobipo-blue group-hover:text-white">
                  <FeatureIcon name={f.icon} />
                </div>
                <h3 className="mb-2 text-base font-bold text-kobipo-navy">{f.title}</h3>
                <p className="mb-4 text-sm leading-relaxed text-kobipo-gray">{f.desc}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-kobipo-green-light px-2.5 py-0.5 text-[10px] font-semibold text-kobipo-green-dark">
                  <span className="h-1 w-1 rounded-full bg-kobipo-green-dark" />
                  {f.tag}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* NASIL ÇALIŞIR */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="mb-4 inline-block rounded-full bg-kobipo-pale px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-kobipo-blue">
              Nasıl çalışır
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">
              3 adımda <span className="text-kobipo-blue">başlayın</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-kobipo-gray">
              Karmaşık kurulum yok, eğitim videosu yok. Hemen başlayın, kullandıkça öğrenin.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Hesabınızı oluşturun",
                desc: "E-posta ve firma bilgileriyle 1 dakikada kayıt olun.",
              },
              {
                step: "02",
                title: "Verilerinizi aktarın",
                desc: "Excel ile cari, ürün ve fatura verilerinizi toplu içe aktarın.",
              },
              {
                step: "03",
                title: "Yönetmeye başlayın",
                desc: "Tek panelden satış, stok, fatura ve raporlarınıza erişin.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-2xl border border-kobipo-border bg-kobipo-offwhite p-6"
              >
                <div className="mb-4 inline-flex h-10 items-center rounded-lg bg-kobipo-navy px-3 text-sm font-extrabold tracking-tight text-white">
                  {s.step}
                </div>
                <h3 className="mb-2 text-base font-bold text-kobipo-navy">{s.title}</h3>
                <p className="text-sm leading-relaxed text-kobipo-gray">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FİYATLANDIRMA */}
      <section id="fiyatlandirma" className="bg-kobipo-offwhite py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="mb-4 inline-block rounded-full bg-kobipo-green-light px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-kobipo-green-dark">
              Fiyatlandırma
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">
              Kobipo <span className="text-kobipo-blue">tamamen ücretsiz</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-kobipo-gray">
              Aylık abonelik yok, gizli ücret yok. Tüm özellikleri ücretsiz kullanın; sadece e-fatura kontörü kullandığınız kadar.
            </p>
          </div>

          <div className="mx-auto max-w-2xl">
            <article className="relative overflow-hidden rounded-3xl border-2 border-kobipo-blue bg-kobipo-navy p-8 text-center text-white shadow-xl sm:p-12">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">
                Ücretsiz
              </div>
              <div className="mt-3 flex items-end justify-center gap-1.5">
                <div className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
                  ₺0
                </div>
                <div className="pb-2 text-sm text-white/55">/ ay</div>
              </div>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/65">
                Kayıt olun, kurulum ücreti veya kredi kartı olmadan tüm modülleri hemen kullanmaya başlayın.
              </p>

              <ul className="mx-auto mt-8 grid max-w-md grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
                {[
                  "Sınırsız kullanıcı",
                  "Cari hesap yönetimi",
                  "Stok ve barkod yönetimi",
                  "E-fatura & e-arşiv",
                  "Gelişmiş raporlar",
                  "Kurulum ücreti yok",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-white/85">
                    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-kobipo-green/25 text-kobipo-green">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className="mt-9 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-kobipo-green py-3.5 text-sm font-bold text-white transition-colors hover:bg-kobipo-green-dark sm:w-auto sm:px-10"
              >
                Ücretsiz Başla
              </Link>
              <p className="mt-4 text-xs text-white/45">
                E-fatura/e-arşiv gönderimi için yalnızca kullandığınız kadar kontör ödersiniz.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* SSS */}
      <section id="sss" className="bg-white py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block rounded-full bg-kobipo-pale px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-kobipo-blue">
              Sıkça sorulanlar
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">
              Aklınızdaki sorular
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                q: "Kobipo'yu kullanmak ücretli mi?",
                a: "Tek şube kullanımı tamamen ücretsizdir — kredi kartı veya kurulum ücreti gerekmez, süre sınırı yoktur. Yalnızca e-fatura/e-arşiv gönderimi için kullandığınız kadar kontör ödersiniz. Birden fazla şubeyle çalışmak isterseniz ek şubeler ücretlidir; detaylar için bizimle iletişime geçebilirsiniz.",
              },
              {
                q: "Mevcut verilerimi (cari, ürün, fatura) içe aktarabilir miyim?",
                a: "Evet. Excel şablonlarımızla cari, ürün, hizmet ve geçmiş faturalarınızı toplu olarak içe aktarabilirsiniz. Karmaşık kurulumlarda ekibimiz size yardımcı olur.",
              },
              {
                q: "E-fatura entegrasyonu nasıl çalışıyor?",
                a: "GİB onaylı altyapımız sayesinde Kobipo üzerinden kestiğiniz faturalar otomatik olarak GİB'e iletilir. Ek bir entegratör ücreti ödemenize gerek yoktur.",
              },
              {
                q: "Verilerim güvende mi?",
                a: "Tüm verileriniz Türkiye merkezli, KVKK uyumlu sunucularda SSL şifrelemesiyle saklanır. Günlük otomatik yedekleme ve felaket kurtarma planımız mevcuttur.",
              },
              {
                q: "İstediğim zaman iptal edebilir miyim?",
                a: "Evet. Aboneliğinizi panelden tek tıkla iptal edebilirsiniz. Verilerinizi her zaman Excel veya PDF olarak dışa aktarabilirsiniz.",
              },
            ].map((item, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-kobipo-border bg-kobipo-offwhite p-5 transition-colors open:bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <span className="text-sm font-bold text-kobipo-navy">{item.q}</span>
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-kobipo-blue transition-transform group-open:rotate-45">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-kobipo-gray">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-kobipo-text px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
            <div className="col-span-2">
              <div className="mb-4 flex items-center gap-2.5">
                <BrandMark size={32} />
                <div className="text-lg font-extrabold tracking-tight text-white">
                  kobi<span className="font-light text-kobipo-light">po</span>
                </div>
              </div>
              <div className="mb-3 text-[11px] font-bold italic text-kobipo-green">
                Az laf, doğru rakam.
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-white/45">
                KOBİ&apos;lerin dijital muhasebe ve işletme yönetim platformu.
                Bulut tabanlı, güvenli ve kullanımı kolay.
              </p>
            </div>

            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                Ürün
              </div>
              <div className="space-y-2.5">
                {["Özellikler", "Fiyatlandırma", "E-Fatura", "Stok Yönetimi", "Raporlar"].map((l) => (
                  <a
                    key={l}
                    href="#ozellikler"
                    className="block text-xs text-white/55 transition-colors hover:text-white"
                  >
                    {l}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                Şirket
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "Hakkımızda", href: "/kurumsal/hakkimizda" },
                  { label: "Blog", href: "/kurumsal/blog" },
                  { label: "Destek", href: "/kurumsal/destek" },
                  { label: "İletişim", href: "/kurumsal/iletisim" },
                  { label: "Kariyer", href: "/kurumsal/kariyer" },
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="block text-xs text-white/55 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 md:flex-row">
            <div className="text-[11px] text-white/35">
              © {new Date().getFullYear()} Kobipo. Tüm hakları saklıdır.
            </div>
            <div className="flex flex-wrap gap-5">
              {[
                { label: "Gizlilik", href: "/kurumsal/gizlilik" },
                { label: "KVKK", href: "/kurumsal/kvkk" },
                { label: "Çerezler", href: "/kurumsal/cerezler" },
                { label: "Kullanım Koşulları", href: "/kurumsal/kullanim-kosullari" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="text-[11px] text-white/35 transition-colors hover:text-white/70"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
