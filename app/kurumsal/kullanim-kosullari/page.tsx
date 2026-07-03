import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata: Metadata = pageMetadata({
  title: "Kullanım Koşulları",
  description:
    "Kobipo Kullanım Koşulları: platformun kullanımı sırasında tarafların hak ve yükümlülüklerini düzenleyen temel kurallar.",
  path: "/kurumsal/kullanim-kosullari",
})

export default function KullanimKosullariPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Kullanim Kosullari"
      description="Kobipo platformunun kullanimi sirasinda taraflarin hak ve yukumluluklerini duzenleyen temel kurallar."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Kullanım Koşulları" },
      ]}
    >
      <LegalContentShell
        updatedAt="27.04.2026"
        sections={[
          {
            id: "genel-kurallar",
            title: "1. Genel Kurallar",
            content: (
              <p>
                Platformu kullanan tum taraflar, gecerli mevzuata ve bu kosullara uygun hareket etmekle yukumludur.
              </p>
            ),
          },
          {
            id: "hesap-guvenligi",
            title: "2. Hesap Guvenligi",
            content: (
              <p>
                Kullanici, hesap bilgilerini gizli tutmakla sorumludur. Yetkisiz kullanim suphelerinde sifre derhal
                degistirilmeli ve destek ekibine bilgi verilmelidir.
              </p>
            ),
          },
          {
            id: "hizmet-devamliligi",
            title: "3. Hizmet Devamliligi",
            content: (
              <p>
                Planli bakim veya teknik gereklilik durumlarinda hizmette gecici kesintiler olabilir. Bu durumlar mumkun
                oldugunca onceden duyurulur.
              </p>
            ),
          },
          {
            id: "fikri-mulkiyet",
            title: "4. Fikri Mulkiyet",
            content: (
              <p>
                Platforma ait marka, yazi, arayuz ve yazilim unsurlari Kobipo'nun fikri mulkiyet haklari kapsamindadir.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
