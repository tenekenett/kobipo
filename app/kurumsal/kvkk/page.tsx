import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata: Metadata = pageMetadata({
  title: "KVKK Aydınlatma Metni",
  description:
    "Kobipo KVKK Aydınlatma Metni: 6698 sayılı Kanun kapsamında kişisel verilerinizin işlenmesine ilişkin haklarınız ve süreçler.",
  path: "/kurumsal/kvkk",
})

export default function KvkkPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="KVKK Aydınlatma Metni"
      description="6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında veri sorumlusu olarak aydınlatma yükümlülüğümüzü bu metinle yerine getiriyoruz."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "KVKK" },
      ]}
    >
      <LegalContentShell
        updatedAt="27.04.2026"
        sections={[
          {
            id: "veri-sorumlusu",
            title: "1. Veri Sorumlusu",
            content: (
              <p>
                Kobipo, platform hizmetleri kapsamında işlenen kişisel veriler bakımından veri sorumlusu sıfatını taşır.
              </p>
            ),
          },
          {
            id: "isleme-amaci",
            title: "2. İşleme Amaçları",
            content: (
              <>
                <p>Hizmetin sağlanması, yasal yükümlülüklerin yerine getirilmesi ve bilgi güvenliğinin temini.</p>
                <p>Müşteri memnuniyeti, destek süreçlerinin yürütülmesi ve ürün geliştirme faaliyetleri.</p>
              </>
            ),
          },
          {
            id: "aktarim",
            title: "3. Verilerin Aktarımı",
            content: (
              <p>
                Veriler, yasal zorunluluklar veya hizmet altyapısının gerektirdiği ölçülerde yurt içi hizmet sağlayıcılarla
                paylaşılabilir. Paylaşımlar gerekli teknik ve idari tedbirler altında gerçekleştirilir.
              </p>
            ),
          },
          {
            id: "basvuru-hakki",
            title: "4. Başvuru Hakkı",
            content: (
              <p>
                KVKK'nin 11. maddesi kapsamındaki taleplerinizi yazılı olarak veya kayıtlı e-posta kanalı ile
                destek@kobipo.com adresine iletebilirsiniz.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
