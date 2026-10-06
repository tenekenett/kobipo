import { filenameFromContentDisposition } from "@/lib/utils"

/**
 * Belge PDF'ini YENİ SEKMEDE açar (tarayıcının PDF görüntüleyicisi; oradan yazdırılır ya da
 * indirilir). 2026-10-07'ye kadar fatura PDF düğmeleri dosyayı doğrudan indiriyordu —
 * tarayıcı "kaydet" penceresi açıyordu.
 *
 * TIKLAMA ANINDA, ilk `await`'ten ÖNCE çağrılmalı: sekme senkron açılır ve PDF gelince
 * içine yüklenir. PDF'i bekleyip sonra `window.open` demek açılır pencere engelleyicisine
 * takılır — resmî PDF Mysoft'tan 6–7 sn'de geliyor, tarayıcının "kullanıcı tıkladı" izni
 * o kadar sürmüyor (gelen e-fatura PDF'i bu yüzden kimi zaman hiç açılmıyordu).
 *
 * Hata olursa açılan sekme kapanır, sebep döner (çağıran toast'la söyler). Sekme yine de
 * engellenmişse dosya eskisi gibi İNDİRİLİR — kullanıcı eli boş kalmasın.
 */
export async function openPdfInNewTab(
  url: string,
  opts: { fallbackName: string },
): Promise<{ ok: true; opened: "tab" | "download" } | { ok: false; error: string }> {
  const tab = window.open("", "_blank")
  if (tab) {
    try {
      tab.document.title = "PDF hazırlanıyor…"
      tab.document.body.style.cssText = "margin:0;font-family:system-ui,sans-serif;color:#555"
      tab.document.body.innerHTML = '<p style="padding:24px">PDF hazırlanıyor…</p>'
    } catch {
      /* sekmenin içine yazılamadı — boş sekme yine de PDF'i bekler */
    }
  }

  try {
    const res = await fetch(url)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      tab?.close()
      return { ok: false, error: data.error || "Bilinmeyen hata" }
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    // Görüntüleyici yüklenene kadar adres yaşamalı; sonra bellekten düşer.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)

    if (tab && !tab.closed) {
      tab.location.replace(blobUrl)
      return { ok: true, opened: "tab" }
    }
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) || opts.fallbackName
    document.body.appendChild(a)
    a.click()
    a.remove()
    return { ok: true, opened: "download" }
  } catch (error: any) {
    tab?.close()
    return { ok: false, error: error?.message || "PDF açılamadı" }
  }
}
