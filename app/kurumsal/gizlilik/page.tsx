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
      title="Gizlilik Politikası"
      description="Kobipo platformunda toplanan verilerin hangi amaçlarla işlendiği, saklandığı ve korunduğu bu metinde açıklanır."
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
                Bu politika, Kobipo ürün ve hizmetlerini kullanan tüm gerçek ve tüzel kişilere ait verilerin toplanması,
                işlenmesi ve korunmasına ilişkin esasları kapsar.
              </p>
            ),
          },
          {
            id: "toplanan-veriler",
            title: "2. Toplanan Veriler",
            content: (
              <>
                <p>Kullanım sürecinde hesap bilgileri, işlem kayıtları ve teknik log verileri toplanabilir.</p>
                <p>Toplanan veriler yalnızca hizmetin sunulması, geliştirilmesi ve güvenliğin sağlanması amacıyla işlenir.</p>
              </>
            ),
          },
          {
            id: "saklama-sureleri",
            title: "3. Saklama Süreleri",
            content: (
              <p>
                Veriler mevzuatın zorunlu kıldığı süreler boyunca veya hizmet ilişkisinin devam ettiği makul sürelerde
                saklanır; süre sonunda uygun yöntemlerle silinir veya anonim hale getirilir.
              </p>
            ),
          },
          {
            id: "haklar",
            title: "4. Kullanıcı Hakları",
            content: (
              <p>
                Kullanıcı; verilerine erişim, düzeltme, silme ve itiraz haklarını yasal çerçevede kullanabilir. Talepler
                destek@kobipo.com üzerinden iletilebilir.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
