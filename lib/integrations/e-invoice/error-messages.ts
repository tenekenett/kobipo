/**
 * Mysoft'un ham API hata metinlerini kullanıcıya gösterilebilir Türkçeye çevirir.
 *
 * Mysoft bazı hataları kendi iç terminolojisiyle döndürür ("İlgili kayıt mongoda
 * bulunamadı. MongoObjectId : 6a4e…"). Bu metinler son kullanıcıya bir şey
 * anlatmadığı gibi, sanki bizim isteğimizde bir sorun varmış izlenimi verir.
 * Burada nedenini ve kullanıcının ne yapabileceğini söyleyen karşılıklara
 * çeviriyoruz; ham metni destek/hata ayıklama için sonda parantez içinde
 * saklıyoruz.
 */

/**
 * "Belge gövdesi sağlayıcıda yok" hatası mı?
 *
 * Mysoft faturanın BAŞLIK kaydını bulur (liste ve getInvoiceInboxStatus çalışır)
 * ama belgeyi kendi doküman deposundan okuyamaz. Teşhis edilmiştir: PDF, HTML,
 * UBL XML, UBL+zarf ve model uçlarının HEPSİ, tenantIdentifierNumber verilse de
 * verilmese de aynı MongoObjectId için aynı hatayı döndürür. Yani gönderdiğimiz
 * uç/parametre ile ilgisi yoktur — sağlayıcıda belge yoktur.
 */
export function isMysoftDocumentMissing(raw: string | null | undefined): boolean {
  return /mongoda bulunamad/i.test(String(raw || ""))
}

/** Mysoft API kullanıcısı bu mükellefe bağlı değil hatası mı? */
export function isMysoftTenantMismatch(raw: string | null | undefined): boolean {
  const low = String(raw || "").toLowerCase()
  return low.includes("firma kullanıcı") || low.includes("kullanıcı bilgileri")
}

export function describeMysoftError(raw: string | null | undefined): string {
  const text = String(raw || "").trim()
  if (!text) return "Bilinmeyen hata"

  if (isMysoftDocumentMissing(text)) {
    return (
      "Faturanın belge içeriği e-fatura sağlayıcısında bulunamadı. Başlık bilgileri " +
      "(tarih, tutar, gönderen) mevcut ama belgenin kendisi sağlayıcıda saklı değil; " +
      "bu yüzden görüntüsü ve kalemleri getirilemiyor. Sağlayıcı kaydı geri yüklemeden " +
      `düzelmez. (sağlayıcı: ${text})`
    )
  }

  if (isMysoftTenantMismatch(text)) {
    return (
      `${text} — Mysoft API kullanıcınız bu firmaya bağlı görünmüyor. E-Dönüşüm ` +
      "Ayarları'ndan kayıtlı Mysoft kullanıcı adı/şifrenizi kontrol edip yeniden kaydedin."
    )
  }

  return text
}
