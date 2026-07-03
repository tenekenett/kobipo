import Link from "next/link"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import type { Metadata } from "next"
import { pageMetadata } from "@/lib/seo/metadata"

const supportItems = [
  { title: "Canli Destek", detail: "Hafta ici 09:00 - 18:00 saatleri arasinda oncelikli canli destek." },
  { title: "E-posta", detail: "Teknik talepleriniz icin: destek@kobipo.com" },
  { title: "Onboarding Yardimi", detail: "Ilk kurulum ve veri aktarma asamasinda adim adim destek." },
]

export const metadata: Metadata = pageMetadata({
  title: "Destek",
  description:
    "Kobipo destek ekibi kurulumdan günlük kullanıma kadar yanınızda. Canlı destek, e-posta ve onboarding yardımı ile hızlı çözüm.",
  path: "/kurumsal/destek",
})

export default function DestekPage() {
  return (
    <CorporatePageShell
      badge="Destek"
      title="Destek ekibimiz yaninizda"
      description="Kurulumdan gunluk kullanima kadar ihtiyac duydugunuz anda ulasabileceginiz bir destek sureci sunuyoruz."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Destek" },
      ]}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {supportItems.map((item) => (
          <article key={item.title} className="rounded-2xl border border-kobipo-border bg-white p-6">
            <h2 className="text-base font-bold text-kobipo-navy">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-kobipo-gray">{item.detail}</p>
          </article>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Sik Sorulan Basliklar</h2>
        <div className="mt-4 space-y-3">
          {[
            "Kullanim baslangicinda veri nasil aktarilir?",
            "E-fatura aktivasyon suresi ne kadar surer?",
            "Kullanici yetkileri nasil tanimlanir?",
          ].map((q) => (
            <div key={q} className="rounded-xl bg-kobipo-offwhite p-3 text-sm text-kobipo-text">
              {q}
            </div>
          ))}
        </div>
        <div className="mt-5">
          <Link href="/kurumsal/iletisim" className="text-sm font-semibold text-kobipo-blue hover:text-kobipo-mid">
            Iletisim kanalina git →
          </Link>
        </div>
      </section>
    </CorporatePageShell>
  )
}
