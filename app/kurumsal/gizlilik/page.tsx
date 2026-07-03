import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata: Metadata = pageMetadata({
  title: "Gizlilik Politikası",
  description:
    "Kobipo Gizlilik Politikası: platformda toplanan verilerin hangi amaçlarla işlendiği, saklandığı ve korunduğu hakkında bilgi.",
  path: "/kurumsal/gizlilik",
})

export default function GizlilikPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Gizlilik Politikasi"
      description="Kobipo platformunda toplanan verilerin hangi amaclarla islendigi, saklandigi ve korundugu bu metinde aciklanir."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Gizlilik" },
      ]}
    >
      <LegalContentShell
        updatedAt="27.04.2026"
        sections={[
          {
            id: "kapsam",
            title: "1. Kapsam",
            content: (
              <p>
                Bu politika, Kobipo urun ve hizmetlerini kullanan tum gercek ve tuzel kisilere ait verilerin toplanmasi,
                islenmesi ve korunmasina iliskin esaslari kapsar.
              </p>
            ),
          },
          {
            id: "toplanan-veriler",
            title: "2. Toplanan Veriler",
            content: (
              <>
                <p>Kullanim surecinde hesap bilgileri, islem kayitlari ve teknik log verileri toplanabilir.</p>
                <p>Toplanan veriler yalnizca hizmetin sunulmasi, gelistirilmesi ve guvenligin saglanmasi amaciyla islenir.</p>
              </>
            ),
          },
          {
            id: "saklama-sureleri",
            title: "3. Saklama Sureleri",
            content: (
              <p>
                Veriler mevzuatin zorunlu kildigi sureler boyunca veya hizmet iliskisinin devam ettigi makul surelerde
                saklanir; sure sonunda uygun yontemlerle silinir veya anonim hale getirilir.
              </p>
            ),
          },
          {
            id: "haklar",
            title: "4. Kullanici Haklari",
            content: (
              <p>
                Kullanici; verilerine erisim, duzeltme, silme ve itiraz haklarini yasal cercevede kullanabilir. Talepler
                destek@kobipo.com uzerinden iletilebilir.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
