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
      title="Kullanım Koşulları"
      description="Kobipo platformunun kullanımı sırasında tarafların hak ve yükümlülüklerini düzenleyen temel kurallar."
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
                Platformu kullanan tüm taraflar, geçerli mevzuata ve bu koşullara uygun hareket etmekle yükümlüdür.
              </p>
            ),
          },
          {
            id: "hesap-guvenligi",
            title: "2. Hesap Güvenliği",
            content: (
              <p>
                Kullanıcı, hesap bilgilerini gizli tutmakla sorumludur. Yetkisiz kullanım şüphelerinde şifre derhal
                değiştirilmeli ve destek ekibine bilgi verilmelidir.
              </p>
            ),
          },
          {
            id: "hizmet-devamliligi",
            title: "3. Hizmet Devamlılığı",
            content: (
              <p>
                Planlı bakım veya teknik gereklilik durumlarında hizmette geçici kesintiler olabilir. Bu durumlar mümkün
                olduğunca önceden duyurulur.
              </p>
            ),
          },
          {
            id: "fikri-mulkiyet",
            title: "4. Fikri Mülkiyet",
            content: (
              <p>
                Platforma ait marka, yazı, arayüz ve yazılım unsurları Kobipo'nun fikri mülkiyet hakları kapsamındadır.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
