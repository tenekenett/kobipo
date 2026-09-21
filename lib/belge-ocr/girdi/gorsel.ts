/**
 * Görsel hazırlığı — fotoğraf ya da rasterlenmiş PDF sayfası modele gitmeden önce.
 *
 * Küçültme ön hazırlık DEĞİL, işin parçası: ham telefon fotoğrafı ~14 kat fazla
 * token yakar ve doğruluğa katkısı ölçülmedi. Tezgâh da aynı boyutla ölçüyor —
 * ikisi ayrışırsa ölçümün maliyet rakamları üretimi temsil etmez.
 *
 * `lib/fis-ocr/extract.ts`ten taşındı; değerler (1568 px, JPEG 85) fişin
 * ölçüldüğü değerlerdir, değiştirmeden önce fiş tezgâhı yeniden koşar.
 */

import sharp from "sharp"

export const UZUN_KENAR = 1568

export type HazirGorsel = {
  jpeg: Buffer
  genislik: number
  yukseklik: number
  boyutKb: number
}

export async function gorselHazirla(dosya: Buffer): Promise<HazirGorsel> {
  const kucuk = await sharp(dosya)
    .rotate() // EXIF yönü: telefon fotoğrafı yan gelirse model fişi okuyamaz
    .resize({ width: UZUN_KENAR, height: UZUN_KENAR, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const olcu = await sharp(kucuk).metadata()
  return {
    jpeg: kucuk,
    genislik: olcu.width ?? 0,
    yukseklik: olcu.height ?? 0,
    boyutKb: Math.round(kucuk.length / 1024),
  }
}
