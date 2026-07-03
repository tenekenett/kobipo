import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata: Metadata = pageMetadata({
  title: "İletişim",
  description:
    "Kobipo ekibiyle satış, teknik destek ve iş birlikleri için iletişime geçin. E-posta, telefon ve ofis bilgilerimiz bu sayfada.",
  path: "/kurumsal/iletisim",
})

export default function IletisimPage() {
  return (
    <CorporatePageShell
      badge="Iletisim"
      title="Ekibimizle iletisime gecin"
      description="Satis, teknik destek veya is birlikleri icin size en uygun kanaldan bize ulasabilirsiniz."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "İletişim" },
      ]}
      cta={{
        title: "Hemen bir gorusme planlayin",
        description: "Platformu ekip yapiniza uygun sekilde kurgulamak icin uzmanlarimiz size eslik etsin.",
        primaryLabel: "Ucretsiz Basla",
        primaryHref: "/signup",
        secondaryLabel: "Destek Sayfasi",
        secondaryHref: "/kurumsal/destek",
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Genel Iletisim</h2>
          <p className="mt-2 text-sm text-kobipo-gray">info@kobipo.com</p>
          <p className="text-sm text-kobipo-gray">+90 (212) 000 00 00</p>
        </article>
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Destek</h2>
          <p className="mt-2 text-sm text-kobipo-gray">destek@kobipo.com</p>
          <p className="text-sm text-kobipo-gray">Hafta ici 09:00 - 18:00</p>
        </article>
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Ofis</h2>
          <p className="mt-2 text-sm text-kobipo-gray">Maslak, Sariyer / Istanbul</p>
          <p className="text-sm text-kobipo-gray">Randevu ile ziyaret</p>
        </article>
      </div>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Hizli Talep Formu</h2>
        <p className="mt-2 text-sm text-kobipo-gray">
          Bu asamada statik bir on izleme formu bulunur. Bir sonraki adimda API baglantisi ile aktif hale getirilebilir.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input disabled value="Ad Soyad" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray" />
          <input disabled value="E-posta" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray" />
          <input disabled value="Firma" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray sm:col-span-2" />
          <textarea disabled value="Mesajiniz" rows={4} className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray sm:col-span-2" />
        </div>
      </section>
    </CorporatePageShell>
  )
}
