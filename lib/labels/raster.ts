// Etiket Tasarımcısı — canvas tabanlı görsel yardımcıları (yalnızca client).
// Yükleme küçültme: e-donusum template-designer'daki downscaleImage yaklaşımı
// (offscreen canvas → PNG data-URI); rotasyon: jsPDF addImage'ın rotation
// parametresi güvenilmez olduğundan bitmap'i önceden döndürürüz.

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // 2MB ham dosya üst sınırı

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Görsel okunamadı"))
    img.src = src
  })
}

/**
 * Yüklenen dosyayı en fazla maxDim piksele küçültüp PNG data-URI döner.
 * Tasarım JSON'unda saklanacağından küçük tutulur (varsayılan 300px).
 */
export async function downscaleImageToDataUrl(
  file: File,
  maxDim = 300
): Promise<string | null> {
  if (typeof document === "undefined") return null
  if (!file.type.startsWith("image/")) return null
  if (file.size > MAX_UPLOAD_BYTES) return null

  const raw = await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
  if (!raw) return null

  try {
    const img = await loadImage(raw)
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL("image/png")
  } catch {
    return null
  }
}

/**
 * Data-URI görseli 90° adımlarla döndürür (PDF için ön-rotasyon).
 * rotation 0'da girdiyi aynen döner; hata durumunda da girdiye düşer.
 */
export async function rotateImageDataUrl(
  dataUrl: string,
  rotation: 0 | 90 | 180 | 270
): Promise<string> {
  if (rotation === 0 || typeof document === "undefined") return dataUrl
  try {
    const img = await loadImage(dataUrl)
    const swap = rotation === 90 || rotation === 270
    const canvas = document.createElement("canvas")
    canvas.width = swap ? img.height : img.width
    canvas.height = swap ? img.width : img.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return dataUrl
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(img, -img.width / 2, -img.height / 2)
    return canvas.toDataURL("image/png")
  } catch {
    return dataUrl
  }
}
