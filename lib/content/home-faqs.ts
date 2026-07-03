// Ana sayfa SSS içeriği — hem görünen accordion (client) hem FAQPage JSON-LD (server)
// bu tek diziden beslenir. Server component'in gerçek diziyi alabilmesi için "use client"
// modülünde DEĞİL, düz bir modülde tutulur.
export const homeFaqs = [
  {
    q: "Kobipo'yu kullanmak ücretli mi?",
    a: "Tek şube kullanımı tamamen ücretsizdir — kredi kartı veya kurulum ücreti gerekmez, süre sınırı yoktur. Yalnızca e-fatura/e-arşiv gönderimi için kullandığınız kadar kontör ödersiniz. Birden fazla şubeyle çalışmak isterseniz ek şubeler ücretlidir; detaylar için bizimle iletişime geçebilirsiniz.",
  },
  {
    q: "Mevcut verilerimi (cari, ürün, fatura) içe aktarabilir miyim?",
    a: "Evet. Excel şablonlarımızla cari, ürün, hizmet ve geçmiş faturalarınızı toplu olarak içe aktarabilirsiniz. Karmaşık kurulumlarda ekibimiz size yardımcı olur.",
  },
  {
    q: "E-fatura entegrasyonu nasıl çalışıyor?",
    a: "GİB onaylı altyapımız sayesinde Kobipo üzerinden kestiğiniz faturalar otomatik olarak GİB'e iletilir. Ek bir entegratör ücreti ödemenize gerek yoktur.",
  },
  {
    q: "Verilerim güvende mi?",
    a: "Tüm verileriniz Türkiye merkezli, KVKK uyumlu sunucularda SSL şifrelemesiyle saklanır. Günlük otomatik yedekleme ve felaket kurtarma planımız mevcuttur.",
  },
  {
    q: "İstediğim zaman iptal edebilir miyim?",
    a: "Evet. Aboneliğinizi panelden tek tıkla iptal edebilirsiniz. Verilerinizi her zaman Excel veya PDF olarak dışa aktarabilirsiniz.",
  },
]
