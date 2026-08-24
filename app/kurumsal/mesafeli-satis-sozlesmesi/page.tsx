import type { Metadata } from "next"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { LegalContentShell } from "@/components/site/legal-content-shell"
import { pageMetadata } from "@/lib/seo/metadata"
import { SELLER } from "@/lib/content/seller"

export const metadata: Metadata = pageMetadata({
  title: "Mesafeli Satış Sözleşmesi",
  description:
    "Kobipo üzerinden yapılan abonelik ve e-Belge kontörü satışlarına ilişkin mesafeli satış sözleşmesi.",
  path: "/kurumsal/mesafeli-satis-sozlesmesi",
})

export default function MesafeliSatisSozlesmesiPage() {
  return (
    <CorporatePageShell
      badge="Yasal"
      title="Mesafeli Satış Sözleşmesi"
      description="Kobipo üzerinden uzaktan iletişim araçlarıyla yapılan abonelik ve e-Belge kontörü satışlarının koşulları."
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Mesafeli Satış Sözleşmesi" },
      ]}
    >
      <LegalContentShell
        updatedAt="24.08.2026"
        sections={[
          {
            id: "taraflar",
            title: "1. Taraflar ve Satıcı Bilgileri",
            content: (
              <>
                <p>
                  İşbu sözleşme, aşağıda bilgileri yer alan SATICI ile Kobipo üzerinden sipariş veren ALICI
                  arasında, uzaktan iletişim araçları kullanılarak kurulmuştur.
                </p>
                <div className="rounded-xl border border-kobipo-border bg-kobipo-offwhite p-4 text-sm">
                  <p className="font-semibold text-kobipo-navy">SATICI</p>
                  <p>{SELLER.title}</p>
                  <p>Adres: {SELLER.address}</p>
                  <p>
                    Vergi Dairesi / VKN: {SELLER.taxOffice} / {SELLER.taxNumber}
                  </p>
                  <p>
                    Telefon: {SELLER.phone} · E-posta: {SELLER.email}
                  </p>
                  {SELLER.mersis ? <p>MERSİS No: {SELLER.mersis}</p> : null}
                  {SELLER.tradeRegistryNo ? <p>Ticaret Sicil No: {SELLER.tradeRegistryNo}</p> : null}
                </div>
                <p>
                  ALICI, sipariş sırasında beyan ettiği ünvan/ad-soyad, VKN/TCKN, adres ve e-posta bilgilerinin
                  doğruluğundan sorumludur. Fatura bu bilgilerle düzenlenir.
                </p>
              </>
            ),
          },
          {
            id: "konu",
            title: "2. Sözleşmenin Konusu",
            content: (
              <p>
                Sözleşmenin konusu, ALICI&apos;nın Kobipo üzerinden elektronik ortamda sipariş verdiği; aşağıda
                nitelikleri ve satış bedeli belirtilen dijital hizmetlerin (yazılım aboneliği, modül/kota
                hakları ve e-Belge kontörü) sunulmasına ilişkin tarafların hak ve yükümlülüklerinin
                belirlenmesidir.
              </p>
            ),
          },
          {
            id: "hizmet",
            title: "3. Hizmetin Nitelikleri ve Bedeli",
            content: (
              <>
                <p>
                  Satışa konu hizmetler tamamen dijitaldir; fiziksel bir mal teslimi yoktur. Hizmetin türü,
                  kapsamı, süresi ve KDV dahil satış bedeli, sipariş sırasında ekranda gösterilir ve ödeme
                  onayından önce ALICI tarafından teyit edilir.
                </p>
                <p>
                  Kobipo&apos;da ilan edilen tüm fiyatlar <strong>KDV dahildir</strong>. Ödeme anında tahsil edilen
                  tutar ile faturada yer alan ödenecek tutar aynıdır.
                </p>
              </>
            ),
          },
          {
            id: "odeme",
            title: "4. Ödeme",
            content: (
              <>
                <p>
                  Ödemeler, kredi kartı/banka kartı ile ödeme kuruluşu {SELLER.paymentProvider} altyapısı
                  üzerinden veya banka havalesi/EFT ile yapılır. Kart bilgileri Kobipo tarafından saklanmaz;
                  ödeme işlemi ödeme kuruluşunun güvenli altyapısında gerçekleşir.
                </p>
                <p>
                  Havale/EFT ile ödemede, sipariş sırasında verilen referans kodunun banka açıklamasına
                  yazılması gerekir. Ödeme, ilgili kod ile eşleştirilip onaylandıktan sonra hizmet aktive
                  edilir.
                </p>
              </>
            ),
          },
          {
            id: "ifa",
            title: "5. İfa ve Teslim",
            content: (
              <p>
                Hizmet elektronik ortamda, ödemenin onaylanmasının ardından derhal ifa edilir: abonelik/modül
                hakları hesaba tanımlanır, satın alınan e-Belge kontörü ALICI&apos;nın e-Dönüşüm hesabına yüklenir.
                Ayrıntı için{" "}
                <a href="/kurumsal/teslimat" className="font-medium text-kobipo-blue underline">
                  Teslimat Koşulları
                </a>{" "}
                sayfasına bakınız.
              </p>
            ),
          },
          {
            id: "cayma",
            title: "6. Cayma Hakkı",
            content: (
              <>
                <p>
                  Mesafeli Sözleşmeler Yönetmeliği uyarınca; elektronik ortamda anında ifa edilen hizmetler ve
                  tüketiciye anında teslim edilen gayrimaddi mallara ilişkin sözleşmelerde <strong>cayma hakkı
                  bulunmamaktadır</strong>. Kobipo&apos;da satılan abonelik ve e-Belge kontörü bu kapsamdadır: ödeme
                  onaylandığı anda ifa başlar.
                </p>
                <p>
                  Tüketici sıfatını haiz olmayan (ticari/mesleki amaçla hareket eden) ALICI bakımından 6502
                  sayılı Kanun&apos;un tüketici işlemlerine ilişkin hükümleri uygulanmaz.
                </p>
                <p>
                  İptal, iade ve istisnai hâller için{" "}
                  <a href="/kurumsal/iptal-iade" className="font-medium text-kobipo-blue underline">
                    İptal ve İade Koşulları
                  </a>{" "}
                  sayfasına bakınız.
                </p>
              </>
            ),
          },
          {
            id: "fatura",
            title: "7. Fatura",
            content: (
              <p>
                Satışa ilişkin fatura, ödeme onayının ardından ALICI&apos;nın sipariş sırasında beyan ettiği bilgilerle
                düzenlenir. ALICI e-Fatura mükellefi ise belge e-Fatura, değilse e-Arşiv fatura olarak
                düzenlenir ve ALICI tarafından panel üzerinden görüntülenip indirilebilir.
              </p>
            ),
          },
          {
            id: "yukumlulukler",
            title: "8. Tarafların Yükümlülükleri",
            content: (
              <>
                <p>
                  SATICI, hizmeti sözleşmeye uygun, özenli ve makul teknik standartlarda sunmakla yükümlüdür.
                  Planlı bakım veya zorunlu teknik müdahalelerde geçici kesintiler olabilir.
                </p>
                <p>
                  ALICI, hesap bilgilerinin gizliliğinden, hesabı üzerinden yapılan işlemlerden ve platforma
                  girdiği verilerin doğruluğundan sorumludur.
                </p>
              </>
            ),
          },
          {
            id: "uyusmazlik",
            title: "9. Uyuşmazlıkların Çözümü",
            content: (
              <p>
                İşbu sözleşmeden doğan uyuşmazlıklarda Türk hukuku uygulanır. Tüketici sıfatını haiz ALICI,
                Ticaret Bakanlığı&apos;nca ilan edilen parasal sınırlar çerçevesinde Tüketici Hakem Heyetleri ile
                Tüketici Mahkemeleri&apos;ne başvurabilir. Diğer hâllerde {SELLER.jurisdiction} Mahkemeleri ve İcra
                Daireleri yetkilidir.
              </p>
            ),
          },
          {
            id: "yururluk",
            title: "10. Yürürlük",
            content: (
              <p>
                ALICI, siparişi onaylamakla işbu sözleşmenin tüm koşullarını okuduğunu, anladığını ve kabul
                ettiğini beyan eder. Sözleşme, siparişin onaylanması ile yürürlüğe girer.
              </p>
            ),
          },
        ]}
      />
    </CorporatePageShell>
  )
}
