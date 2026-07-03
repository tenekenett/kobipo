import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"

const values = [
  {
    title: "Sadelik",
    description: "KOBİ'lerin finans operasyonunu yalnızca gerekli verilerle, sade bir panelde yönetmesini sağlarız.",
  },
  {
    title: "Güven",
    description: "İşletme verilerinde güvenlik ve doğruluk bizim için temel ürün özelliğidir.",
  },
  {
    title: "Hız",
    description: "Günlük operasyonu hızlandıran akışları önceleyerek ekiplerin verimli çalışmasını destekleriz.",
  },
]

const timeline = [
  { year: "2023", text: "Kobipo vizyonu KOBİ odaklı bir muhasebe platformu olarak şekillendi." },
  { year: "2024", text: "Cari hesap ve fatura akışları canlı müşterilerde aktif kullanıma alındı." },
  { year: "2025", text: "Stok, e-dönüşüm ve raporlama modülleri tek panelde birleştirildi." },
  { year: "2026", text: "Kurumsal ölçekte daha güçlü otomasyon ve analitik altyapı devreye alındı." },
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
      badge="Şirket"
      title="KOBİ'ler için net, hızlı ve güvenli finans yönetimi."
      description="Kobipo, işletmelerin finansal süreçlerini tek bir merkezde toplamak için geliştirildi. Hedefimiz, ekiplerin karar alırken güvendiği bir operasyon paneli sunmak."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Hakkımızda" },
      ]}
      cta={{
        title: "Kobipo'yu ekibinizle deneyin",
        description: "30 gün ücretsiz başlayın, işletmenizin tüm operasyonunu tek panelde görün.",
        primaryLabel: "Ücretsiz Başla",
        primaryHref: "/signup",
        secondaryLabel: "İletişime Geçin",
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
        <h2 className="text-lg font-bold text-kobipo-navy">Hikâyemiz</h2>
        <p className="mt-2 text-sm leading-relaxed text-kobipo-text">
          İşletmelerin günlük finans akışında yaşanan dağınıklığı, tek bir dijital merkezde toplamak için yola çıktık.
          Kobipo bugün; cari yönetim, e-fatura, stok takibi ve raporlamayı birleştirerek KOBİ ekiplerinin daha hızlı
          ve daha doğru karar almasına yardımcı olur.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Kısa Zaman Çizelgesi</h2>
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
