import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"
import { SELLER } from "@/lib/content/seller"

export const metadata: Metadata = pageMetadata({
  title: "İptal ve İade Koşulları",
  description:
    "Kobipo abonelik ve e-Belge kontörü satışlarında iptal, iade ve cayma hakkı koşulları.",
  path: "/kurumsal/iptal-iade",
})

export default function IptalIadePage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="İptal ve İade Koşulları"
      description="Abonelik ve e-Belge kontörü satışlarında iptal, iade ve cayma hakkının nasıl işlediği."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "İptal ve İade Koşulları" },
      ]}
    >
      <LegalContentShell
        updatedAt="24.08.2026"
        sections={[
          {
            id: "kapsam",
            title: "1. Kapsam",
            content: (
              <p>
                Bu koşullar, {SELLER.brand} üzerinden satın alınan dijital hizmetler için geçerlidir: yazılım
                aboneliği, modül ve kota hakları ile e-Belge kontörü. Fiziksel mal satışı bulunmadığından
                kargo, teslim alma veya ürün iadesi süreçleri uygulanmaz.
              </p>
            ),
          },
          {
            id: "cayma-hakki",
            title: "2. Cayma Hakkı ve İstisnası",
            content: (
              <>
                <p>
                  Mesafeli Sözleşmeler Yönetmeliği&apos;nde, elektronik ortamda anında ifa edilen hizmetler ile
                  tüketiciye anında teslim edilen gayrimaddi mallar cayma hakkının istisnaları arasında
                  sayılmıştır. {SELLER.brand}&apos;da satılan hizmetler ödeme onaylandığı anda ifa edildiğinden{" "}
                  <strong>cayma hakkı kullanılamaz</strong>.
                </p>
                <p>
                  Uygulamada bunun anlamı şudur: e-Belge kontörü hesabınıza yüklendiği, abonelik hakları
                  tanımlandığı anda hizmet ifa edilmiş sayılır.
                </p>
                <p>
                  Ticari veya mesleki amaçla hareket eden alıcılar tüketici sayılmadığından, 6502 sayılı
                  Kanun&apos;un tüketici işlemlerine ilişkin hükümleri bu alıcılar bakımından uygulanmaz.
                </p>
              </>
            ),
          },
          {
            id: "iade-halleri",
            title: "3. İade Yapılan Hâller",
            content: (
              <>
                <p>Cayma hakkı istisnasına rağmen, aşağıdaki durumlarda bedel iade edilir:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Ödeme alındığı hâlde hizmetin teknik bir nedenle ifa edilememesi (ör. kontörün hesabınıza
                    yüklenememesi ve sorunun giderilememesi).
                  </li>
                  <li>Aynı siparişin sehven mükerrer tahsil edilmesi.</li>
                  <li>Tahsil edilen tutarın, siparişte gösterilen tutardan fazla olması.</li>
                </ul>
                <p>
                  Bu hâllerde iade, ödemenin yapıldığı yönteme ve aynı hesaba yapılır. Kartlı ödemelerde tutarın
                  kart hesabına yansıma süresi ilgili banka/ödeme kuruluşunun işleyişine bağlıdır.
                </p>
              </>
            ),
          },
          {
            id: "abonelik-iptali",
            title: "4. Abonelik İptali",
            content: (
              <>
                <p>
                  Aboneliğinizi panelden dilediğiniz zaman iptal edebilirsiniz. İptal, <strong>dönem sonunda</strong>{" "}
                  geçerli olur: ödemesini yaptığınız dönem boyunca hizmet açık kalır, dönem bitiminde yenileme
                  yapılmaz.
                </p>
                <p>
                  Kullanılmakta olan bir dönemin ortasında yapılan iptalde, o döneme ait bedel kısmen veya
                  tamamen iade edilmez; hizmet dönem sonuna kadar sunulmaya devam eder.
                </p>
              </>
            ),
          },
          {
            id: "kontor",
            title: "5. Kontör Kullanımı",
            content: (
              <p>
                Yüklenen e-Belge kontörü, hesabınıza tanımlandığı andan itibaren kullanılabilir hâle gelir.
                Kullanılmış kontör iade edilemez. Kontörün geçerlilik süresi, satın alma sırasında pakette
                belirtilir.
              </p>
            ),
          },
          {
            id: "fatura-iptali",
            title: "6. Faturanın İptali",
            content: (
              <p>
                Satışın iptal edildiği hâllerde faturanın da geri alınması gerekir. e-Arşiv faturalar mevzuatın
                izin verdiği süre içinde iptal edilir; e-Fatura düzenlenmiş ise belge iptal edilemeyeceğinden
                alıcıya iade faturası düzenlenir. Her iki hâlde de işlem {SELLER.brand} tarafından yürütülür,
                alıcıdan ek bir işlem beklenmez.
              </p>
            ),
          },
          {
            id: "basvuru",
            title: "7. Başvuru",
            content: (
              <p>
                İptal ve iade talepleriniz için sipariş numaranızla birlikte{" "}
                <a href={`mailto:${SELLER.supportEmail}`} className="font-medium text-kobipo-blue underline">
                  {SELLER.supportEmail}
                </a>{" "}
                adresine yazabilir veya {SELLER.phone} numarasından bize ulaşabilirsiniz. Talepler en geç 14 gün
                içinde sonuçlandırılır.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
