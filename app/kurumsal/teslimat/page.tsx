import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"
import { SELLER } from "@/lib/content/seller"

export const metadata: Metadata = pageMetadata({
  title: "Teslimat Koşulları",
  description:
    "Kobipo dijital hizmetlerinde teslimat: abonelik ve e-Belge kontörü ödeme onayının ardından anında hesabınıza tanımlanır.",
  path: "/kurumsal/teslimat",
})

export default function TeslimatPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Teslimat Koşulları"
      description="Kobipo'da satılan her şey dijitaldir; teslimat elektronik ortamda, ödeme onayının hemen ardından yapılır."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Teslimat Koşulları" },
      ]}
    >
      <LegalContentShell
        updatedAt="24.08.2026"
        sections={[
          {
            id: "dijital-teslim",
            title: "1. Dijital Teslim",
            content: (
              <>
                <p>
                  {SELLER.brand} üzerinden satılan hizmetlerin tamamı dijitaldir. Fiziksel bir ürün
                  gönderilmediğinden <strong>kargo, kargo ücreti ve teslim süresi kavramları uygulanmaz</strong>.
                </p>
                <p>
                  Teslimat, satın alınan hizmetin hesabınıza tanımlanmasıyla gerçekleşir ve ödemenin
                  onaylanmasının hemen ardından otomatik olarak yapılır.
                </p>
              </>
            ),
          },
          {
            id: "abonelik",
            title: "2. Abonelik ve Modüller",
            content: (
              <p>
                Ödeme onaylandığında satın alınan paket, modüller ve şube/firma kotaları hesabınıza anında
                tanımlanır; ilgili ekranlar aynı oturumda kullanılabilir hâle gelir. Abonelik dönemi ödeme
                tarihinde başlar.
              </p>
            ),
          },
          {
            id: "kontor",
            title: "3. e-Belge Kontörü",
            content: (
              <>
                <p>
                  Kartla yapılan ödemelerde kontör, ödeme onayının ardından birkaç saniye içinde e-Dönüşüm
                  hesabınıza yüklenir.
                </p>
                <p>
                  Havale/EFT ile ödemede yükleme, ödemenin hesabımıza geçtiğinin teyit edilmesinden sonra
                  yapılır. Bu teyit, bankaların çalışma saatlerine bağlı olarak genellikle aynı iş günü,
                  en geç takip eden iş günü içinde tamamlanır.
                </p>
              </>
            ),
          },
          {
            id: "gecikme",
            title: "4. Teslimin Gerçekleşmemesi",
            content: (
              <p>
                Teknik bir nedenle hizmet hesabınıza tanımlanamazsa, sorun giderilene kadar takip edilir ve
                sonuç size bildirilir. Giderilemeyen hâllerde tahsil edilen bedel iade edilir; ayrıntı için{" "}
                <a href="/kurumsal/iptal-iade" className="font-medium text-kobipo-blue underline">
                  İptal ve İade Koşulları
                </a>{" "}
                sayfasına bakınız.
              </p>
            ),
          },
          {
            id: "fatura",
            title: "5. Fatura",
            content: (
              <p>
                Satışa ilişkin fatura, teslim ile birlikte elektronik ortamda düzenlenir. Faturanıza panelden
                ilgili siparişin satırındaki bağlantıdan ulaşabilir, PDF olarak indirebilirsiniz.
              </p>
            ),
          },
          {
            id: "iletisim",
            title: "6. İletişim",
            content: (
              <p>
                Teslimatla ilgili sorularınız için{" "}
                <a href={`mailto:${SELLER.supportEmail}`} className="font-medium text-kobipo-blue underline">
                  {SELLER.supportEmail}
                </a>{" "}
                adresine yazabilir veya {SELLER.phone} numarasından bize ulaşabilirsiniz.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
