import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata: Metadata = pageMetadata({
  title: "Çerez Politikası",
  description:
    "Kobipo Çerez Politikası: web ve uygulama deneyimini iyileştirmek için çerezleri nasıl kullandığımızı öğrenin.",
  path: "/kurumsal/cerezler",
})

export default function CerezlerPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Çerez Politikası"
      description="Kobipo'nun web ve uygulama deneyimini iyileştirmek amacıyla çerezleri nasıl kullandığını bu metinde bulabilirsiniz."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Çerezler" },
      ]}
    >
      <LegalContentShell
        updatedAt="27.04.2026"
        sections={[
          {
            id: "cerez-nedir",
            title: "1. Çerez Nedir?",
            content: (
              <p>
                Çerezler, web sitesi kullanımını daha verimli hale getirmek için tarayıcıda saklanan küçük metin dosyalarıdır.
              </p>
            ),
          },
          {
            id: "cerez-turleri",
            title: "2. Kullandığımız Çerez Türleri",
            content: (
              <>
                <p>Zorunlu çerezler: Oturum ve güvenlik fonksiyonları için gereklidir.</p>
                <p>Analitik çerezler: Ürünün kullanım seyrini anlamak ve deneyimi iyileştirmek amacıyla kullanılır.</p>
              </>
            ),
          },
          {
            id: "yonetim",
            title: "3. Çerez Tercihlerini Yönetme",
            content: (
              <p>
                Tarayıcı ayarlarınızdan çerezleri silebilir veya engelleyebilirsiniz. Ancak bazı zorunlu çerezlerin devre
                dışı bırakılması platformun belirli özelliklerini etkileyebilir.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
