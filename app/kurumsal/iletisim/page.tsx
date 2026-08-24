import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"
import { SELLER } from "@/lib/content/seller"

export const metadata: Metadata = pageMetadata({
  title: "İletişim",
  description:
    "Kobipo ekibiyle satış, teknik destek ve iş birlikleri için iletişime geçin. E-posta, telefon ve ofis bilgilerimiz bu sayfada.",
  path: "/kurumsal/iletisim",
})

export default function IletisimPage() {
  return (
    <CorporatePageShell
      badge="İletişim"
      title="Ekibimizle iletişime geçin"
      description="Satış, teknik destek veya iş birlikleri için size en uygun kanaldan bize ulaşabilirsiniz."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "İletişim" },
      ]}
      cta={{
        title: "Hemen bir görüşme planlayın",
        description: "Platformu ekip yapınıza uygun şekilde kurgulamak için uzmanlarımız size eşlik etsin.",
        primaryLabel: "Ücretsiz Başla",
        primaryHref: "/signup",
        secondaryLabel: "Destek Sayfası",
        secondaryHref: "/kurumsal/destek",
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Genel İletişim</h2>
          <p className="mt-2 text-sm text-kobipo-gray">{SELLER.email}</p>
          <p className="text-sm text-kobipo-gray">{SELLER.phone}</p>
        </article>
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Destek</h2>
          <p className="mt-2 text-sm text-kobipo-gray">{SELLER.supportEmail}</p>
          <p className="text-sm text-kobipo-gray">Hafta içi 09:00 - 18:00</p>
        </article>
        <article className="rounded-2xl border border-kobipo-border bg-white p-6">
          <h2 className="text-base font-bold text-kobipo-navy">Adres</h2>
          <p className="mt-2 text-sm text-kobipo-gray">{SELLER.address}</p>
        </article>
      </div>

      {/* Satıcı künyesi: e-ticaret mevzuatı ve ödeme kuruluşu incelemesi bunu arar;
          faturayı kesen tüzel kişiyle aynı olmak zorundadır. Kaynak: lib/content/seller.ts */}
      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Satıcı Bilgileri</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="shrink-0 text-kobipo-gray">Ünvan:</dt>
            <dd className="font-medium text-kobipo-text">{SELLER.title}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-kobipo-gray">Vergi Dairesi / VKN:</dt>
            <dd className="font-medium text-kobipo-text">
              {SELLER.taxOffice} / {SELLER.taxNumber}
            </dd>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <dt className="shrink-0 text-kobipo-gray">Adres:</dt>
            <dd className="font-medium text-kobipo-text">{SELLER.address}</dd>
          </div>
          {SELLER.mersis ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-kobipo-gray">MERSİS No:</dt>
              <dd className="font-medium text-kobipo-text">{SELLER.mersis}</dd>
            </div>
          ) : null}
          {SELLER.tradeRegistryNo ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-kobipo-gray">Ticaret Sicil No:</dt>
              <dd className="font-medium text-kobipo-text">{SELLER.tradeRegistryNo}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-4 text-xs text-kobipo-gray">
          Satış koşulları için{" "}
          <a href="/kurumsal/mesafeli-satis-sozlesmesi" className="font-medium text-kobipo-blue underline">
            Mesafeli Satış Sözleşmesi
          </a>
          ,{" "}
          <a href="/kurumsal/teslimat" className="font-medium text-kobipo-blue underline">
            Teslimat Koşulları
          </a>{" "}
          ve{" "}
          <a href="/kurumsal/iptal-iade" className="font-medium text-kobipo-blue underline">
            İptal ve İade Koşulları
          </a>{" "}
          sayfalarına bakınız.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-kobipo-border bg-white p-6">
        <h2 className="text-lg font-bold text-kobipo-navy">Hızlı Talep Formu</h2>
        <p className="mt-2 text-sm text-kobipo-gray">
          Bu aşamada statik bir ön izleme formu bulunur. Bir sonraki adımda API bağlantısı ile aktif hale getirilebilir.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input disabled value="Ad Soyad" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray" />
          <input disabled value="E-posta" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray" />
          <input disabled value="Firma" className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray sm:col-span-2" />
          <textarea disabled value="Mesajınız" rows={4} className="rounded-xl border border-kobipo-border bg-kobipo-offwhite px-4 py-3 text-sm text-kobipo-gray sm:col-span-2" />
        </div>
      </section>
    </CorporatePageShell>
  )
}
