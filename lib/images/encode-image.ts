/**
 * Canvas → yüklenebilir görsel dosyası (yalnızca tarayıcı).
 *
 * Kırpma penceresi (components/stok/image-crop-dialog.tsx) sonucu buradan
 * geçer: WebP üretilir, üretilemezse JPEG'e düşülür.
 *
 * Neden istemcide: telefondan seçilen 4 MB'lık fotoğraf cihazdan çıkmadan
 * ~30 KB'a iniyor; kafe wifi'sinde 10 saniyelik yükleme anlık hale geliyor.
 * Ölçtük (800px, gerçek fotoğraflar): tarayıcı JPEG 35-66 KB → WebP 23-41 KB.
 */

/** 0.8: bu içerikte gözle farkı görünmeyen en küçük dosyayı veren nokta. */
const QUALITY = 0.8

/**
 * Canvas içeriğini WebP dosyasına çevirir; tarayıcı WebP kodlayamıyorsa JPEG.
 *
 * TUZAK: canvas.toBlob desteklenmeyen bir tür isteyince spec gereği SESSİZCE
 * PNG döner. Kırpılmış bir fotoğrafın PNG'si ~800 KB — JPEG'den de kötü.
 * Safari'ye canvas WebP kodlama ancak 16.4'te geldi, kafedeki tablet eski
 * olabilir. Bu yüzden çıktının türü DOĞRULANIR, öylece kabul edilmez.
 */
export async function canvasToImageFile(
  canvas: HTMLCanvasElement,
  baseName: string
): Promise<File> {
  const clean = baseName.replace(/\.[^.]+$/, "").trim() || "urun"

  const webp = await toBlob(canvas, "image/webp")
  if (webp && webp.type === "image/webp") {
    return new File([webp], `${clean}.webp`, { type: "image/webp", lastModified: Date.now() })
  }

  const jpeg = await toBlob(canvas, "image/jpeg")
  if (jpeg && jpeg.type === "image/jpeg") {
    return new File([jpeg], `${clean}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
  }

  throw new Error("Fotoğraf bu tarayıcıda dönüştürülemedi")
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}
