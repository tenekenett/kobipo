/**
 * Belge PDF'ini YENİ SEKMEDE, ucun KENDİ adresinden açar (tarayıcının PDF görüntüleyicisi;
 * oradan yazdırılır ya da indirilir). 2026-10-07'ye kadar fatura PDF düğmeleri dosyayı
 * doğrudan indiriyordu — tarayıcı "kaydet" penceresi açıyordu.
 *
 * Neden blob değil de adres: Chrome'un görüntüleyicisi "indir"de dosya adını gerçek
 * adresin Content-Disposition'ından alır (uçlar faturanın numarasını yazar,
 * lib/api/pdf-response.ts → inlineDisposition). Blob adresinde ad anlamsız çıkıyordu.
 * Hata da sekmede okunur sayfa olarak görünür (withNavigationErrorPage).
 *
 * TIKLAMA ANINDA, hiçbir `await`'ten önce çağrılmalı: sonradan açılan sekme açılır pencere
 * engelleyicisine takılır. Resmî PDF Mysoft'tan 6–7 sn'de geldiği için sekme o süre
 * "PDF hazırlanıyor…" gösterir (eski belge, yanıt gelene kadar ekranda kalır).
 *
 * `false` = tarayıcı sekmeyi engelledi; çağıran kullanıcıya söyler.
 */
export function openPdfInNewTab(url: string): boolean {
  const tab = window.open("", "_blank")
  if (!tab) return false
  try {
    tab.document.title = "PDF hazırlanıyor…"
    tab.document.body.style.cssText = "margin:0;font-family:system-ui,sans-serif;color:#555"
    tab.document.body.innerHTML = '<p style="padding:24px">PDF hazırlanıyor…</p>'
  } catch {
    /* sekmenin içine yazılamadı — yükleme yine de başlar */
  }
  tab.location.replace(new URL(url, window.location.href).href)
  return true
}

export const PDF_TAB_BLOCKED = {
  title: "Yeni sekme açılamadı",
  description: "Tarayıcı açılır pencereyi engelledi; bu site için açılır pencerelere izin verip tekrar deneyin.",
  variant: "destructive" as const,
}
