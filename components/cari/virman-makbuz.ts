import { filenameFromContentDisposition } from "@/lib/utils"

/**
 * Virman makbuzunu indirir (`/api/cari/virman/[id]/makbuz`). Cari kartındaki
 * satır düğmesi ve kayıt sonrası bildirim aynı yoldan geçer. Hata mesajı
 * fırlatılır; toast çağıranındır.
 */
export async function downloadVirmanMakbuz(virmanId: string): Promise<void> {
  const res = await fetch(`/api/cari/virman/${virmanId}/makbuz`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Makbuz üretilemedi")
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) || "Virman-Makbuzu.pdf"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
