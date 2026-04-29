import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"

export default function CerezlerPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Cerez Politikasi"
      description="Kobipo'nun web ve uygulama deneyimini iyilestirmek amaciyla cerezleri nasil kullandigini bu metinde bulabilirsiniz."
    >
      <LegalContentShell
        updatedAt="27.04.2026"
        sections={[
          {
            id: "cerez-nedir",
            title: "1. Cerez Nedir?",
            content: (
              <p>
                Cerezler, web sitesi kullanimini daha verimli hale getirmek icin tarayicida saklanan kucuk metin dosyalaridir.
              </p>
            ),
          },
          {
            id: "cerez-turleri",
            title: "2. Kullandigimiz Cerez Turleri",
            content: (
              <>
                <p>Zorunlu cerezler: Oturum ve guvenlik fonksiyonlari icin gereklidir.</p>
                <p>Analitik cerezler: Urunun kullanim seyrini anlamak ve deneyimi iyilestirmek amaciyla kullanilir.</p>
              </>
            ),
          },
          {
            id: "yonetim",
            title: "3. Cerez Tercihlerini Yonetme",
            content: (
              <p>
                Tarayici ayarlarinizdan cerezleri silebilir veya engelleyebilirsiniz. Ancak bazi zorunlu cerezlerin devre
                disi birakilmasi platformun belirli ozelliklerini etkileyebilir.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
