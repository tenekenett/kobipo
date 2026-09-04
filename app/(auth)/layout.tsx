"use client"

import Image from "next/image"
import Link from "next/link"
import { BarChart3, ShieldCheck, Zap } from "lucide-react"

export const dynamic = "force-dynamic"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-kobipo-navy">
      {/* Animasyonlu arka plan: gradient + floating bloblar + geometrik şekiller */}
      <div
        aria-hidden
        className="absolute inset-0 animate-auth-gradient bg-gradient-to-br from-kobipo-navy via-kobipo-blue to-kobipo-mid opacity-95"
      />

      {/* Floating bloblar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-kobipo-mid/40 blur-3xl animate-auth-blob" />
        <div
          className="absolute right-0 top-0 h-[28rem] w-[28rem] rounded-full bg-kobipo-light/30 blur-3xl animate-auth-blob"
          style={{ animationDelay: "-5s" }}
        />
        <div
          className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-kobipo-green/20 blur-3xl animate-auth-blob"
          style={{ animationDelay: "-9s" }}
        />
      </div>

      {/* Dekoratif geometrik şekiller */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* Yavaş dönen halka — sağ üst */}
        <div className="absolute right-12 top-12 h-32 w-32 animate-auth-spin-slow rounded-full border border-white/10" />
        <div
          className="absolute right-20 top-20 h-20 w-20 animate-auth-spin-slow rounded-full border border-white/15"
          style={{ animationDirection: "reverse", animationDuration: "30s" }}
        />
        {/* Küçük yüzen noktalar */}
        <div className="absolute left-1/4 top-16 h-2 w-2 rounded-full bg-white/40 animate-auth-float" />
        <div
          className="absolute left-3/4 bottom-24 h-3 w-3 rounded-full bg-kobipo-light/60 animate-auth-float"
          style={{ animationDelay: "-2s" }}
        />
        <div
          className="absolute left-1/2 top-2/3 h-1.5 w-1.5 rounded-full bg-white/50 animate-auth-float"
          style={{ animationDelay: "-1s" }}
        />
      </div>

      {/* Grid pattern overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 min-h-screen w-full">
        <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 lg:grid-cols-2">
          {/* SOL — MARKA + TANITIM PANELI (sadece large+) */}
          <aside className="hidden flex-col justify-between p-12 text-white lg:flex">
            <div>
              <div className="flex items-center animate-auth-slide-up">
                <Link href="/" className="inline-flex shrink-0 items-center">
                  <Image
                    src="/assets/logos/kobipo-logo-yatay-koyu-transparent.svg"
                    alt="Kobipo"
                    width={240}
                    height={69}
                    priority
                  />
                </Link>
              </div>

              <h2
                className="mt-20 text-4xl font-extrabold leading-tight text-white animate-auth-slide-up"
                style={{ animationDelay: "0.1s" }}
              >
                KOBİ'lerin <br />
                <span className="bg-gradient-to-r from-white via-kobipo-light to-white bg-clip-text text-transparent">
                  dijital muhasebe
                </span>{" "}
                <br />
                platformu.
              </h2>
              <p
                className="mt-5 max-w-md text-base leading-relaxed text-white/80 animate-auth-slide-up"
                style={{ animationDelay: "0.2s" }}
              >
                Cari hesaplar, stok takibi, e-fatura ve finansal raporlar tek platformda.
                Az laf, doğru rakam.
              </p>

              <div className="mt-12 grid gap-4 max-w-md">
                <FeatureRow
                  delay="0.3s"
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="Anlık raporlar"
                  desc="Satış, alış, KDV — tek bakışta görün."
                />
                <FeatureRow
                  delay="0.4s"
                  icon={<ShieldCheck className="h-5 w-5" />}
                  title="Resmi e-Fatura"
                  desc="GİB onaylı, doğrudan entegre."
                />
                <FeatureRow
                  delay="0.5s"
                  icon={<Zap className="h-5 w-5" />}
                  title="Hızlı kurulum"
                  desc="Dakikalar içinde hazırsınız."
                />
              </div>
            </div>

            <footer
              className="mt-12 text-xs text-white/50 animate-auth-slide-up"
              style={{ animationDelay: "0.6s" }}
            >
              © {new Date().getFullYear()} Kobipo. Tüm hakları saklıdır.
            </footer>
          </aside>

          {/* SAĞ — FORM */}
          <main className="flex items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-md">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}

function FeatureRow({
  icon,
  title,
  desc,
  delay,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  delay: string
}) {
  return (
    <div
      className="flex items-start gap-3 animate-auth-slide-up"
      style={{ animationDelay: delay }}
    >
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-kobipo-light ring-1 ring-white/15 backdrop-blur-md">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-white/70">{desc}</p>
      </div>
    </div>
  )
}
