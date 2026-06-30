"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  Activity,
  ArrowDown,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  FileText,
  Layers,
  MousePointerClick,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react"

export type LandingPost = {
  slug: string
  title: string
  excerpt: string
  category: string
  readTime: string
  date: string
  author: string
  coverTone: "blue" | "navy" | "green"
}

const toneGrad: Record<LandingPost["coverTone"], string> = {
  blue: "from-kobipo-blue/30 to-kobipo-pale",
  navy: "from-kobipo-navy/30 to-kobipo-light/60",
  green: "from-kobipo-green/30 to-kobipo-green-light",
}

const MODULES = [
  { icon: FileText, title: "e-Fatura & e-Arşiv", desc: "GİB uyumlu kesim, tevkifat, istisna ve gelen fatura yönetimi tek ekranda.", tone: "blue" },
  { icon: Building2, title: "Cari Hesaplar", desc: "Müşteri/tedarikçi bakiyeleri, açık fatura ve yaşlandırma anlık takip.", tone: "navy" },
  { icon: Boxes, title: "Stok & Depo", desc: "Çoklu depo, transfer ve kritik seviye alarmlarıyla sıfır stok sürprizi.", tone: "green" },
  { icon: Wallet, title: "Kasa & Banka", desc: "Tahsilat, ödeme ve mutabakat; nakit akışını gün gün net gör.", tone: "blue" },
  { icon: Receipt, title: "Tevkifat & KDV", desc: "Hazır GİB kodlarından seç, oran otomatik gelsin, beyan hazır olsun.", tone: "navy" },
  { icon: CreditCard, title: "Çek & Senet", desc: "Portföy, vade ve durum takibini tek akışta yönet.", tone: "green" },
  { icon: BarChart3, title: "Raporlar", desc: "Kâr-zarar, bilanço, nakit akışı ve vergi raporları tek tıkla.", tone: "blue" },
  { icon: ShieldCheck, title: "Güvenli Bulut", desc: "Şifreli altyapı, rol bazlı yetki ve şube yönetimi.", tone: "navy" },
]

const STEPS = [
  { n: "01", title: "Ücretsiz kaydol", desc: "Dakikalar içinde firmanı oluştur, e-Dönüşüm bilgilerini gir." },
  { n: "02", title: "Faturanı kes", desc: "İlk e-Faturanı tasarla, tevkifat/istisna dahil GİB'e gönder." },
  { n: "03", title: "İşini yönet", desc: "Cari, stok, kasa ve raporlarla işletmeni tek panelden büyüt." },
]

const MARQUEE = [
  "e-Fatura", "e-Arşiv", "Tevkifat", "Cari Hesap", "Stok", "Çoklu Depo", "Kasa", "Banka",
  "Çek-Senet", "Kâr-Zarar", "Bilanço", "Nakit Akışı", "KDV", "Muhtasar", "Şube Yönetimi",
]

function Counter({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [val, setVal] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !done.current) {
            done.current = true
            const start = performance.now()
            const dur = 1600
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / dur)
              const eased = 1 - Math.pow(1 - t, 3)
              setVal(to * eased)
              if (t < 1) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }
        })
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [to])
  return (
    <span ref={ref}>
      {val.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}

export function BlogLanding({ posts }: { posts: LandingPost[] }) {
  const [progress, setProgress] = useState(0)
  const heroDecorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1)
      setProgress(Math.min(1, Math.max(0, p)))
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".kbl-reveal")
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("kbl-in")
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.14 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Hero parallax: fare hareketine göre dekoratif katman hafifçe kayar.
  useEffect(() => {
    const el = heroDecorRef.current
    if (!el || !window.matchMedia("(pointer:fine)").matches) return
    let raf = 0
    const onMove = (ev: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const x = (ev.clientX / window.innerWidth - 0.5) * 30
        const y = (ev.clientY / window.innerHeight - 0.5) * 30
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      })
    }
    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Yumuşak (eased) bölüm geçişi: tüm sayfa-içi çıpa (#) tıklamaları.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest?.('a[href^="#"]') as HTMLAnchorElement | null
      if (!a) return
      const id = a.getAttribute("href")!.slice(1)
      const target = id ? document.getElementById(id) : null
      if (!target) return
      ev.preventDefault()
      const startY = window.scrollY
      const endY = target.getBoundingClientRect().top + startY - 72
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        window.scrollTo(0, endY)
        return
      }
      const dist = endY - startY
      const dur = Math.min(1300, Math.max(520, Math.abs(dist) * 0.6))
      const start = performance.now()
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur)
        window.scrollTo(0, startY + dist * ease(t))
        if (t < 1) requestAnimationFrame(step)
        else {
          target.classList.add("kbl-flash")
          setTimeout(() => target.classList.remove("kbl-flash"), 900)
        }
      }
      requestAnimationFrame(step)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  return (
    <div className="min-h-screen bg-kobipo-offwhite font-sans text-kobipo-text">
      <style>{KBL_CSS}</style>

      {/* okuma ilerleme çubuğu */}
      <div className="fixed left-0 top-0 z-[60] h-1 w-full bg-transparent">
        <div
          className="h-full bg-gradient-to-r from-kobipo-blue via-kobipo-green to-kobipo-blue transition-[width] duration-150 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-kobipo-navy/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-none">
              <div className="text-xl font-extrabold tracking-tight text-white">
                kobi<span className="font-light text-kobipo-light">po</span>
              </div>
              <div className="mt-0.5 text-[9px] font-bold italic tracking-wide text-kobipo-green">Az laf, doğru rakam.</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            <a href="#moduller" className="text-sm font-medium text-white/70 transition-colors hover:text-white">Moduller</a>
            <a href="#nasil" className="text-sm font-medium text-white/70 transition-colors hover:text-white">Nasıl çalışır</a>
            <a href="#blog" className="text-sm font-medium text-white/70 transition-colors hover:text-white">Blog</a>
            <Link href="/kurumsal/hakkimizda" className="text-sm font-medium text-white/70 transition-colors hover:text-white">Hakkımızda</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/signin" className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 sm:px-4 sm:text-sm">Giriş Yap</Link>
            <Link href="/signup" className="group relative overflow-hidden rounded-lg bg-kobipo-green px-3 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03] sm:px-4 sm:text-sm">
              <span className="relative z-10">Ücretsiz Başla</span>
              <span className="absolute inset-0 -translate-x-full bg-white/25 transition-transform duration-500 group-hover:translate-x-full" />
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-kobipo-navy px-6 pb-24 pt-20 sm:pt-28">
        <div className="kbl-grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <div ref={heroDecorRef} className="pointer-events-none absolute inset-0 transition-transform duration-300 ease-out will-change-transform">
          <div className="kbl-aurora absolute inset-0 opacity-70" />
          <div className="kbl-blob absolute -left-24 top-10 h-72 w-72 rounded-full bg-kobipo-blue/40" />
          <div className="kbl-blob absolute right-0 top-40 h-80 w-80 rounded-full bg-kobipo-green/30" style={{ animationDelay: "-6s" }} />
          <div className="kbl-blob absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-kobipo-mid/30" style={{ animationDelay: "-3s" }} />
        </div>

        <div className="relative mx-auto max-w-5xl text-center">
          <div className="kbl-reveal mb-6 inline-flex items-center gap-2 rounded-full border border-kobipo-green/40 bg-kobipo-green/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-kobipo-green">
            <Sparkles className="h-3.5 w-3.5" />
            KOBİ'ler için tek panel
          </div>

          <h1 className="kbl-reveal mx-auto max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-6xl" style={{ transitionDelay: "0.06s" }}>
            İşletmenin tüm rakamları,{" "}
            <span className="kbl-shine bg-gradient-to-r from-kobipo-green via-white to-kobipo-light bg-clip-text text-transparent">
              tek akıllı panelde
            </span>
          </h1>

          <p className="kbl-reveal mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg" style={{ transitionDelay: "0.12s" }}>
            e-Fatura, cari, stok, kasa-banka ve raporlama bir arada. Bulut tabanlı, GİB uyumlu ve
            kullanması gerçekten kolay. Muhasebeyi karmaşadan çıkarıp işine odaklan.
          </p>

          <div className="kbl-reveal mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ transitionDelay: "0.18s" }}>
            <Link href="/signup" className="group inline-flex items-center gap-2 rounded-xl bg-kobipo-green px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-kobipo-green/20 transition-transform hover:scale-[1.04]">
              Ücretsiz Başla
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a href="#moduller" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10">
              <MousePointerClick className="h-4 w-4" />
              Sistemi keşfet
            </a>
          </div>

          {/* yüzen e-fatura kartı */}
          <div className="kbl-reveal relative mx-auto mt-16 w-full max-w-md" style={{ transitionDelay: "0.24s" }}>
            <div className="kbl-glow pointer-events-none absolute -inset-8 rounded-[3rem] bg-kobipo-blue/30 blur-3xl" />
            <div className="kbl-float relative rounded-3xl border border-white/15 bg-white/95 p-5 text-left shadow-2xl shadow-black/40 backdrop-blur">
              <div className="flex items-center justify-between border-b border-kobipo-border pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-kobipo-blue/10 text-kobipo-blue"><FileText className="h-4 w-4" /></span>
                  <div>
                    <div className="text-sm font-bold text-kobipo-navy">e-Arşiv Fatura</div>
                    <div className="text-[10px] text-kobipo-gray">AMA2026000000167</div>
                  </div>
                </div>
                <span className="rounded-full bg-kobipo-green/15 px-2.5 py-1 text-[10px] font-bold text-kobipo-green-dark">Gönderildi</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5 pt-4">
                {[
                  ["Matrah", "₺2.692,50"],
                  ["KDV %20", "₺538,50"],
                  ["Tevkifat", "−₺215,40"],
                ].map(([k, v], i) => (
                  <div key={k} className="kbl-float-slow rounded-xl bg-kobipo-offwhite p-3 text-center" style={{ animationDelay: `${-i}s` }}>
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-kobipo-gray">{k}</div>
                    <div className="mt-1 text-[13px] font-bold text-kobipo-navy">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-kobipo-navy px-4 py-3">
                <span className="text-xs font-semibold text-white/70">Genel Toplam</span>
                <span className="text-lg font-extrabold text-kobipo-green">₺3.015,60</span>
              </div>
            </div>
            <div className="kbl-float absolute -right-4 -top-5 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-xl" style={{ animationDelay: "-1.5s" }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-kobipo-green text-white"><CheckCircle2 className="h-4 w-4" /></span>
              <div className="leading-tight">
                <div className="text-[11px] font-bold text-kobipo-navy">Fatura kaydedildi</div>
                <div className="text-[9px] font-semibold text-kobipo-green-dark">1 saniyede</div>
              </div>
            </div>
            <div className="kbl-spin-slow pointer-events-none absolute -left-6 bottom-6 h-14 w-14 rounded-2xl border border-dashed border-kobipo-green/50" />
            <div className="kbl-float pointer-events-none absolute -left-5 bottom-16 flex h-11 w-11 items-center justify-center rounded-2xl bg-kobipo-blue text-white shadow-lg" style={{ animationDelay: "-2s" }}>
              <Zap className="h-5 w-5" />
            </div>
          </div>

          <a href="#moduller" className="kbl-reveal mt-14 inline-flex flex-col items-center gap-1 text-white/50 transition-colors hover:text-white" style={{ transitionDelay: "0.3s" }} aria-label="Aşağı kaydır">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Keşfet</span>
            <ArrowDown className="kbl-bounce h-4 w-4" />
          </a>
        </div>
      </section>

      {/* MARQUEE */}
      <div className="overflow-hidden border-y border-kobipo-border bg-white py-4">
        <div className="flex w-max">
          {[0, 1].map((dup) => (
            <div key={dup} className="kbl-marquee flex shrink-0 items-center gap-3 pr-3" aria-hidden={dup === 1}>
              {MARQUEE.map((m) => (
                <span key={m} className="flex items-center gap-2 whitespace-nowrap rounded-full bg-kobipo-offwhite px-4 py-1.5 text-sm font-semibold text-kobipo-navy">
                  <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />
                  {m}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* STATS */}
      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { to: 12, suffix: "+", label: "Entegre modül" },
            { to: 100, suffix: "%", label: "GİB uyumlu" },
            { to: 3, suffix: " dk", label: "Kurulum süresi" },
            { to: 0, suffix: "₺", label: "Başlangıç ücreti", pre: true },
          ].map((s, i) => (
            <div key={s.label} className="kbl-reveal rounded-2xl border border-kobipo-border bg-white p-6 text-center shadow-card" style={{ transitionDelay: `${i * 0.07}s` }}>
              <div className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">
                {s.pre ? s.suffix : null}
                <Counter to={s.to} suffix={s.pre ? "" : s.suffix} />
              </div>
              <div className="mt-1.5 text-xs font-semibold text-kobipo-gray">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SHOWCASE — saniyeler içinde fatura (yeşil poster) */}
      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div className="kbl-reveal relative mx-auto w-full max-w-sm lg:order-1">
            <div className="kbl-glow pointer-events-none absolute -inset-6 rounded-[3rem] bg-kobipo-green/30 blur-3xl" />
            <div className="kbl-float relative overflow-hidden rounded-[2rem] shadow-2xl shadow-kobipo-navy/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/blog/fatura-saniyeler.jpg" alt="Saniyeler içinde fatura kesin — Kobipo" width={1080} height={1350} loading="lazy" className="w-full" />
              <div className="kbl-sweep pointer-events-none absolute inset-0" />
            </div>
          </div>
          <div className="kbl-reveal lg:order-2" style={{ transitionDelay: "0.1s" }}>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-green/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-green-dark">
              <Zap className="h-3.5 w-3.5" /> Saniyeler içinde
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">Kağıt, kalem ve kargo beklemeye son</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-kobipo-gray sm:text-base">
              Faturalarını dijitalde saniyeler içinde oluştur, müşterinin e-postasına anında gönder. Kesim, gönderim ve arşivleme tek akışta.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Tek tıkla e-Fatura / e-Arşiv kesimi",
                "Müşterinin e-postasına anında iletim",
                "GİB onaylı, otomatik arşivleme",
                "Tevkifat, istisna ve döviz desteği",
              ].map((t, i) => (
                <li key={t} className="kbl-reveal flex items-center gap-3 text-sm font-medium text-kobipo-navy" style={{ transitionDelay: `${0.14 + i * 0.07}s` }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kobipo-green/15 text-kobipo-green-dark"><CheckCircle2 className="h-4 w-4" /></span>
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="group mt-7 inline-flex items-center gap-2 rounded-xl bg-kobipo-navy px-6 py-3 text-sm font-bold text-white transition-transform hover:scale-[1.04]">
              Hemen dene <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* CANLI PANEL */}
      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div className="kbl-reveal">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-green/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-green-dark">
              <Activity className="h-3.5 w-3.5" /> Canlı panel
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">Verin anında görselleşir</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-kobipo-gray sm:text-base">
              Ciro, tahsilat ve gider akışını gerçek zamanlı izle. Her fatura ve her hareket panele
              anında yansır — Excel'e veri taşımaya son.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { icon: Users, label: "Aktif cari", to: 248 },
                { icon: Database, label: "Aylık belge", to: 1320 },
                { icon: Clock, label: "Sn / fatura", to: 8 },
              ].map((k, i) => (
                <div key={k.label} className="kbl-reveal rounded-xl border border-kobipo-border bg-white p-4 text-center shadow-card" style={{ transitionDelay: `${i * 0.08}s` }}>
                  <k.icon className="mx-auto h-4 w-4 text-kobipo-blue" />
                  <div className="mt-1.5 text-xl font-extrabold text-kobipo-navy">
                    <Counter to={k.to} />
                  </div>
                  <div className="text-[10px] font-semibold text-kobipo-gray">{k.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="kbl-reveal relative overflow-hidden rounded-3xl border border-kobipo-border bg-white p-6 shadow-card" style={{ transitionDelay: "0.1s" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-kobipo-gray">Aylık ciro</div>
                <div className="text-2xl font-extrabold text-kobipo-navy">
                  ₺<Counter to={428} />K
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-kobipo-green/15 px-2.5 py-1 text-xs font-bold text-kobipo-green-dark">
                <TrendingUp className="h-3.5 w-3.5" /> +18%
              </span>
            </div>

            <svg viewBox="0 0 300 70" className="mt-4 h-16 w-full" fill="none" preserveAspectRatio="none">
              <path d="M0,55 C40,50 60,20 100,28 S160,55 200,30 250,12 300,22" className="kbl-spark" stroke="rgb(var(--kb-blue))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            <div className="mt-4 flex h-32 items-end gap-2">
              {[40, 64, 50, 78, 58, 90, 70, 100].map((h, i) => (
                <div key={i} className="flex h-full flex-1 items-end">
                  <div
                    className="kbl-bar w-full rounded-t-md bg-gradient-to-t from-kobipo-blue to-kobipo-mid"
                    style={{ height: `${h}%`, transitionDelay: `${i * 0.06}s` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between text-[10px] font-medium text-kobipo-gray">
              {["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu"].map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MODULES */}
      <section id="moduller" className="scroll-mt-24 px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="kbl-reveal mx-auto max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-pale px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-blue">
              <Layers className="h-3.5 w-3.5" /> Tek sistemde her şey
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">İşletmeni yöneten modüller</h2>
            <p className="mt-3 text-sm leading-relaxed text-kobipo-gray sm:text-base">
              Ayrı ayrı program kullanmaya son. Kobipo, muhasebeden e-dönüşüme tüm operasyonu birbirine bağlar.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m, i) => (
              <div
                key={m.title}
                className="kbl-reveal kbl-card group relative overflow-hidden rounded-2xl border border-kobipo-border bg-white p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-kobipo-navy/10"
                style={{ transitionDelay: `${(i % 4) * 0.06}s` }}
              >
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-kobipo-pale/0 transition-colors duration-300 group-hover:bg-kobipo-pale/60" />
                <span className={`relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${toneGrad[m.tone as LandingPost["coverTone"]]} text-kobipo-navy transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                  <m.icon className="h-6 w-6" />
                </span>
                <h3 className="relative mt-4 text-base font-bold text-kobipo-navy">{m.title}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-kobipo-gray">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="nasil" className="scroll-mt-24 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="kbl-reveal text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-green/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-green-dark">
              <Zap className="h-3.5 w-3.5" /> 3 adımda başla
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">Dakikalar içinde hazır</h2>
          </div>

          <div className="relative mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-kobipo-border to-transparent md:block" />
            {STEPS.map((s, i) => (
              <div key={s.n} className="kbl-reveal relative rounded-2xl border border-kobipo-border bg-white p-7 text-center" style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-kobipo-navy text-xl font-extrabold text-white shadow-lg">
                  {s.n}
                </div>
                <h3 className="mt-5 text-lg font-bold text-kobipo-navy">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-kobipo-gray">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SHOWCASE — e-postaya anında (yeşil poster) */}
      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div className="kbl-reveal">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-pale px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-blue">
              <Receipt className="h-3.5 w-3.5" /> Anında teslim
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">Müşterine saniyeler içinde ulaş</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-kobipo-gray sm:text-base">
              Kestiğin fatura otomatik PDF'e dönüşür, müşterinin e-postasına anında gider. Takip, durum ve arşivleme tek ekranda.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["PDF + e-posta", "Otomatik arşiv", "Durum takibi", "GİB onayı"].map((t) => (
                <span key={t} className="rounded-full border border-kobipo-border bg-white px-3 py-1.5 text-xs font-semibold text-kobipo-navy">{t}</span>
              ))}
            </div>
          </div>
          <div className="kbl-reveal relative mx-auto w-full max-w-sm" style={{ transitionDelay: "0.1s" }}>
            <div className="kbl-glow pointer-events-none absolute -inset-6 rounded-[3rem] bg-kobipo-green/30 blur-3xl" />
            <div className="kbl-float relative overflow-hidden rounded-[2rem] shadow-2xl shadow-kobipo-navy/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/blog/fatura-poster.jpg" alt="Saniyeler içinde fatura kesin — kağıtsız fatura" width={1080} height={1350} loading="lazy" className="w-full" />
              <div className="kbl-sweep pointer-events-none absolute inset-0" />
            </div>
          </div>
        </div>
      </section>

      {/* BLOG TEASER */}
      <section id="blog" className="scroll-mt-24 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="kbl-reveal flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-kobipo-pale px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-kobipo-blue">
                <FileText className="h-3.5 w-3.5" /> Blog
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-kobipo-navy sm:text-4xl">İşine değer katan içerikler</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-kobipo-gray">
                Finans, e-dönüşüm ve operasyon yönetimi üzerine ekibinin hemen uygulayabileceği pratik rehberler.
              </p>
            </div>
            <Link href="/kurumsal/blog" className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-kobipo-border px-4 py-2.5 text-sm font-semibold text-kobipo-navy transition-colors hover:border-kobipo-blue hover:text-kobipo-blue">
              Tüm yazılar
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            {posts.map((post, i) => (
              <Link
                key={post.slug}
                href={`/kurumsal/blog/${post.slug}`}
                className="kbl-reveal group overflow-hidden rounded-2xl border border-kobipo-border bg-white transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-kobipo-navy/10"
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                <div className={`relative h-28 overflow-hidden bg-gradient-to-br ${toneGrad[post.coverTone]}`}>
                  <div className="kbl-grid-bg absolute inset-0 opacity-30" />
                  <FileText className="absolute bottom-3 right-3 h-10 w-10 text-white/40 transition-transform duration-500 group-hover:scale-125 group-hover:rotate-6" />
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-kobipo-pale px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-kobipo-blue">{post.category}</span>
                    <span className="text-xs text-kobipo-gray">{post.readTime}</span>
                  </div>
                  <h3 className="mt-3 text-base font-bold leading-snug text-kobipo-navy transition-colors group-hover:text-kobipo-blue">{post.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-kobipo-gray line-clamp-2">{post.excerpt}</p>
                  <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-kobipo-blue">
                    Yazıyı oku
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* WIDE BANNER (mavi) — tarayıcı penceresi çerçevesi */}
      <section className="px-6 py-12">
        <div className="kbl-reveal mx-auto max-w-5xl overflow-hidden rounded-2xl border border-kobipo-border bg-white shadow-2xl shadow-kobipo-navy/20">
          <div className="flex items-center gap-2 border-b border-kobipo-border bg-kobipo-offwhite px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <div className="ml-3 hidden flex-1 items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] text-kobipo-gray sm:flex">
              <ShieldCheck className="h-3 w-3 text-kobipo-green" /> kobipo.com
            </div>
          </div>
          <div className="group relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/blog/fatura-banner.jpg"
              alt="Saniyeler içinde fatura kesin — Kobipo"
              width={1344}
              height={1080}
              loading="lazy"
              className="w-full transition-transform duration-1000 ease-out group-hover:scale-[1.03]"
            />
            <div className="kbl-sweep pointer-events-none absolute inset-0" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20 pt-4">
        <div className="kbl-reveal relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-kobipo-navy px-8 py-14 text-center sm:px-12">
          <div className="kbl-aurora pointer-events-none absolute inset-0 opacity-60" />
          <div className="kbl-blob pointer-events-none absolute -right-16 -top-10 h-56 w-56 rounded-full bg-kobipo-green/30" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Bugün başla, ilk faturanı bu hafta kes
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Kredi kartı gerekmez. Kurulum dakikalar sürer. Az laf, doğru rakam.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="group inline-flex items-center gap-2 rounded-xl bg-kobipo-green px-8 py-3.5 text-sm font-bold text-white transition-transform hover:scale-[1.04]">
                Ücretsiz Başla
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/kurumsal/iletisim" className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                Demo iste
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-kobipo-text px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="text-lg font-extrabold tracking-tight text-white">
              kobi<span className="font-light text-kobipo-light">po</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/55">
            <Link href="/kurumsal/hakkimizda" className="transition-colors hover:text-white">Hakkımızda</Link>
            <Link href="/kurumsal/blog" className="transition-colors hover:text-white">Blog</Link>
            <Link href="/kurumsal/iletisim" className="transition-colors hover:text-white">İletişim</Link>
            <Link href="/kurumsal/gizlilik" className="transition-colors hover:text-white">Gizlilik</Link>
            <Link href="/kurumsal/kvkk" className="transition-colors hover:text-white">KVKK</Link>
          </div>
          <div className="text-[11px] text-white/35">© {new Date().getFullYear()} Kobipo</div>
        </div>
      </footer>
    </div>
  )
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <clipPath id="kbl-logo-clip">
          <rect width="36" height="36" rx="9" />
        </clipPath>
      </defs>
      <rect width="36" height="36" rx="9" className="fill-kobipo-blue" />
      <polygon points="0,36 36,0 36,36" className="fill-kobipo-navy" clipPath="url(#kbl-logo-clip)" />
      <path d="M5,22 A13,13 0 1,1 31,22" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M29,14 L31,22 L25,20" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="25" r="4.5" className="fill-kobipo-green" />
    </svg>
  )
}

const KBL_CSS = `
.kbl-aurora{background:radial-gradient(60% 60% at 20% 30%, rgb(var(--kb-blue) / 0.55), transparent 60%),radial-gradient(50% 50% at 80% 20%, rgb(var(--kb-green) / 0.35), transparent 60%),radial-gradient(60% 60% at 60% 90%, rgb(var(--kb-mid) / 0.45), transparent 60%);background-size:180% 180%;animation:kbl-aurora 18s ease-in-out infinite}
@keyframes kbl-aurora{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.kbl-blob{filter:blur(46px);animation:kbl-blob 16s ease-in-out infinite;will-change:transform}
@keyframes kbl-blob{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(28px,-22px) scale(1.12)}66%{transform:translate(-22px,18px) scale(0.93)}}
.kbl-float{animation:kbl-float 6s ease-in-out infinite;will-change:transform}
.kbl-float-slow{animation:kbl-float 9s ease-in-out infinite;will-change:transform}
@keyframes kbl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
.kbl-marquee{animation:kbl-marquee 30s linear infinite}
@keyframes kbl-marquee{from{transform:translateX(0)}to{transform:translateX(-100%)}}
.kbl-shine{background-size:200% auto;animation:kbl-shine 5s linear infinite}
@keyframes kbl-shine{to{background-position:200% center}}
.kbl-spin-slow{animation:kbl-spin 22s linear infinite}
@keyframes kbl-spin{to{transform:rotate(360deg)}}
.kbl-sweep{background:linear-gradient(115deg,transparent 32%,rgba(255,255,255,.28) 48%,transparent 62%);background-size:250% 100%;background-position:200% 0;animation:kbl-sweep 5.5s ease-in-out infinite}
@keyframes kbl-sweep{0%{background-position:200% 0}55%,100%{background-position:-120% 0}}
.kbl-glow{animation:kbl-glow 5s ease-in-out infinite}
@keyframes kbl-glow{0%,100%{opacity:.4;transform:scale(0.97)}50%{opacity:.8;transform:scale(1.04)}}
.kbl-reveal{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1)}
.kbl-reveal.kbl-in{opacity:1;transform:none}
.kbl-grid-bg{background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:44px 44px}
.kbl-bounce{animation:kbl-bounce 2.2s ease-in-out infinite}
@keyframes kbl-bounce{0%,100%{transform:translateY(0);opacity:.55}50%{transform:translateY(7px);opacity:1}}
.kbl-flash{animation:kbl-flash .9s ease-out}
@keyframes kbl-flash{30%{box-shadow:0 0 0 6px rgb(var(--kb-green) / 0.18)}100%{box-shadow:0 0 0 0 rgb(var(--kb-green) / 0)}}
.kbl-bar{transform:scaleY(0);transform-origin:bottom;transition:transform .9s cubic-bezier(.22,1,.36,1)}
.kbl-in .kbl-bar{transform:scaleY(1)}
.kbl-spark{stroke-dasharray:640;stroke-dashoffset:640;transition:stroke-dashoffset 1.8s ease .25s}
.kbl-in .kbl-spark{stroke-dashoffset:0}
.kbl-card::after{content:"";position:absolute;inset:0;border-radius:1rem;padding:1px;background:linear-gradient(130deg,rgb(var(--kb-blue) / 0.55),rgb(var(--kb-green) / 0.55));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .3s;pointer-events:none}
.kbl-card:hover::after{opacity:1}
@media (prefers-reduced-motion: reduce){.kbl-aurora,.kbl-blob,.kbl-float,.kbl-float-slow,.kbl-marquee,.kbl-shine,.kbl-spin-slow,.kbl-bounce,.kbl-flash,.kbl-sweep,.kbl-glow{animation:none!important}.kbl-reveal{opacity:1;transform:none;transition:none}.kbl-bar{transform:none}.kbl-spark{stroke-dashoffset:0}}
`
