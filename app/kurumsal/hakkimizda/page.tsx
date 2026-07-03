import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"

const values = [
  {
    title: "Sadelik",
    description: "KOBI'lerin finans operasyonunu yalnizca gerekli verilerle, sade bir panelde yonetmesini saglariz.",
  },
  {
    title: "Guven",
    description: "Isletme verilerinde guvenlik ve dogruluk bizim icin temel urun ozelligidir.",
  },
  {
    title: "Hiz",
    description: "Gunluk operasyonu hizlandiran akislari onceleyerek ekiplerin verimli calismasini destekleriz.",
  },
]

const timeline = [
  { year: "2023", text: "Kobipo vizyonu KOBI odakli bir muhasebe platformu olarak sekillendi." },
  { year: "2024", text: "Cari hesap ve fatura akislari canli musterilerde aktif kullanima alindi." },
  { year: "2025", text: "Stok, e-donusum ve raporlama modulleri tek panelde birlestirildi." },
  { year: "2026", text: "Kurumsal olcekte daha guclu otomasyon ve analitik altyapi devreye alindi." },
]

export const metadata: Metadata = pageMetadata({
  title: "Hakkımızda",
  description:
    "Kobipo, KOBİ'lerin finansal süreçlerini tek merkezde toplayan dijital muhasebe ve işletme yönetim platformudur. Vizyonumuzu ve hikâyemizi keşfedin.",
  path: "/kurumsal/hakkimizda",
})

export default function HakkimizdaPage() {
  return (
    <CorporatePageShell
      badge="Sirket"
      title="KOBI'ler icin net, hizli ve guvenli finans yonetimi."
      description="Kobipo, isletmelerin finansal sureclerini tek bir merkezde toplamak icin gelistirildi. Hedefimiz, ekiplerin karar alirken guvendigi bir operasyon paneli sunmak."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Hakkımızda" },
      ]}
      cta={{
        title: "Kobipo'yu ekibinizle deneyin",
        description: "30 gun ucretsiz baslayin, isletmenizin tum operasyonunu tek panelde gorun.",
        primaryLabel: "Ucretsiz Basla",
        primaryHref: "/signup",
        secondaryLabel: "Iletisime Gecin",
        secondaryHref: "/kurumsal/iletisim",
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {values.map((value) => (
          <article key={value.title} className="rounded-2xl border border-kobipo-border bg-white p-6">
            <h2 className="text-lg font-bold text-kobipo-navy">{value.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-kobipo-gray">{value.description}</p>
          </article>
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Hikayemiz</h2>
        <p className="mt-2 text-sm leading-relaxed text-kobipo-text">
          Isletmelerin gunluk finans akisinda yasanan daginikligi, tek bir dijital merkezde toplamak icin yola ciktik.
          Kobipo bugun; cari yonetim, e-fatura, stok takibi ve raporlamayi birlestirerek KOBI ekiplerinin daha hizli
          ve daha dogru karar almasina yardimci olur.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Kisa Zaman Cizelgesi</h2>
        <div className="mt-4 space-y-3">
          {timeline.map((item) => (
            <div key={item.year} className="flex gap-4 rounded-xl bg-kobipo-offwhite p-3">
              <div className="w-16 flex-shrink-0 text-sm font-bold text-kobipo-blue">{item.year}</div>
              <p className="text-sm text-kobipo-text">{item.text}</p>
            </div>
          ))}
        </div>
      </section>
    </CorporatePageShell>
  )
}
