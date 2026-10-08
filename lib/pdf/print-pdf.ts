/**
 * Belge PDF'ini YAZDIRIR: PDF gizli bir çerçevede açılır, tarayıcının yazdırma penceresi
 * o çerçeve için çağrılır — kâğıda belgenin kendisi çıkar.
 *
 * Neden `window.print()` değil: o, EKRANI basar (menü, düğmeler, kartlar, yan çubuk).
 * Fatura önizlemesindeki "Yazdır" 2026-10-08'e kadar böyleydi ve çıktı bozuk geliyordu.
 *
 * Çerçevede yazdırma engellenirse PDF yeni sekmede açılır; oradan yazdırılır.
 */
export function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const frame = document.createElement("iframe")
  frame.style.position = "fixed"
  frame.style.width = "0"
  frame.style.height = "0"
  frame.style.border = "0"
  frame.src = url
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      window.open(url, "_blank")
    }
    // Yazdırma penceresi kapanana kadar dosya yaşamalı.
    setTimeout(() => {
      frame.remove()
      URL.revokeObjectURL(url)
    }, 60_000)
  }
  document.body.appendChild(frame)
}

/**
 * Ucun ürettiği PDF'i indirip yazdırır. Uç hata dönerse (ya da PDF dışında bir şey)
 * yazdırma penceresi açılmaz, sebep çağırana döner — kullanıcıya söylenir.
 */
export async function printPdfFromUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: body?.error || `PDF üretilemedi (${res.status}).` }
  }
  if (!(res.headers.get("Content-Type") || "").includes("pdf")) {
    return { ok: false, error: "Sunucu PDF döndürmedi." }
  }
  printPdfBlob(await res.blob())
  return { ok: true }
}
