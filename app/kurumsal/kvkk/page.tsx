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
      title="KVKK Aydinlatma Metni"
      description="6698 sayili Kisisel Verilerin Korunmasi Kanunu kapsaminda veri sorumlusu olarak aydinlatma yukumlulugumuzu bu metinle yerine getiriyoruz."
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
                Kobipo, platform hizmetleri kapsaminda islenen kisisel veriler bakimindan veri sorumlusu sifatini tasir.
              </p>
            ),
          },
          {
            id: "isleme-amaci",
            title: "2. Isleme Amaçlari",
            content: (
              <>
                <p>Hizmetin saglanmasi, yasal yukumluluklerin yerine getirilmesi ve bilgi guvenliginin temini.</p>
                <p>Musteri memnuniyeti, destek sureclerinin yurutilmesi ve urun gelistirme faaliyetleri.</p>
              </>
            ),
          },
          {
            id: "aktarim",
            title: "3. Verilerin Aktarimi",
            content: (
              <p>
                Veriler, yasal zorunluluklar veya hizmet altyapisinin gerektirdigi olculerde yurt ici hizmet saglayicilarla
                paylasilabilir. Paylasimlar gerekli teknik ve idari tedbirler altinda gerceklestirilir.
              </p>
            ),
          },
          {
            id: "basvuru-hakki",
            title: "4. Basvuru Hakki",
            content: (
              <p>
                KVKK'nin 11. maddesi kapsamindaki taleplerinizi yazili olarak veya kayitli e-posta kanali ile
                destek@kobipo.com adresine iletebilirsiniz.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
