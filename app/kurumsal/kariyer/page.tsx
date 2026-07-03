import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"

const jobs = [
  { title: "Frontend Developer", location: "Istanbul / Hibrit", type: "Tam zamanli" },
  { title: "Customer Success Specialist", location: "Uzaktan", type: "Tam zamanli" },
  { title: "Product Designer", location: "Istanbul / Hibrit", type: "Tam zamanli" },
]

export const metadata: Metadata = pageMetadata({
  title: "Kariyer",
  description:
    "Kobipo'da açık pozisyonları inceleyin. Ürün, teknoloji ve müşteri deneyimini birlikte geliştiren ekibimize katılın.",
  path: "/kurumsal/kariyer",
})

export default function KariyerPage() {
  return (
    <CorporatePageShell
      badge="Kariyer"
      title="Kobipo'da gelecegi birlikte insa ediyoruz"
      description="Urun, teknoloji ve musteri deneyimini birlikte gelistiren bir ekip kulturune sahibiz. Acik pozisyonlarimizi inceleyin."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Kariyer" },
      ]}
    >
      <section className="rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Neden Kobipo?</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            "Sahiplenme odakli calisma kulturu",
            "Hizli urun gelistirme dongusu",
            "Gercek musteri problemine odaklanan ekip",
          ].map((item) => (
            <div key={item} className="rounded-xl bg-kobipo-offwhite p-3 text-sm text-kobipo-text">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Acik Pozisyonlar</h2>
        <div className="mt-4 space-y-3">
          {jobs.map((job) => (
            <article key={job.title} className="rounded-xl border border-kobipo-border p-4">
              <h3 className="text-base font-semibold text-kobipo-navy">{job.title}</h3>
              <p className="mt-1 text-sm text-kobipo-gray">
                {job.location} · {job.type}
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg border border-kobipo-blue px-3 py-1.5 text-xs font-semibold text-kobipo-blue transition-colors hover:bg-kobipo-pale"
              >
                Basvur
              </button>
            </article>
          ))}
        </div>
      </section>
    </CorporatePageShell>
  )
}
