/**
 * Fiş görselini modele okutur. SUNUCU tarafı — anahtar tarayıcıya gitmez.
 *
 * 2026-09-21: sağlayıcı çağrısı ve görsel küçültme `lib/belge-ocr`a TAŞINDI
 * (saglayici.ts, girdi/gorsel.ts); burada yalnız fişe özgü kısım kaldı: prompt,
 * şema, ödeme kümesi ve sonuç biçimi. Davranış birebir — fiş tezgâhı
 * (`scripts/ai-belge-test.ts --tur fis`) taşımadan önce ve sonra aynı sayıları verir.
 */

import { TARAMA_PROMPT, TARAMA_SEMA, type Fis, type FisOdeme, type FisOdemeSekli } from "./schema"
import { VARSAYILAN_MODEL } from "./models"
import { modeleSor, TaramaHatasi, type ModelKullanimi } from "@/lib/belge-ocr/saglayici"
import { gorselHazirla } from "@/lib/belge-ocr/girdi/gorsel"

export { VARSAYILAN_MODEL, DENENEBILIR_MODELLER } from "./models"
export { TaramaHatasi }

export type TaramaKullanim = ModelKullanimi

export type TaramaSonucu = {
  fisler: Fis[]
  model: string
  saglayici: string
  semaliydi: boolean
  sureMs: number
  kullanim: TaramaKullanim
  gorsel: { genislik: number; yukseklik: number; boyutKb: number }
}

/**
 * Ödeme şeklini kümeye zorlar.
 *
 * Küme şemaya `enum` olarak YAZILAMIYOR (strict json_schema'da enum + null
 * bileşimi bazı sağlayıcılarda reddediliyor), yani modelin küme dışına çıkması
 * mümkün: "KREDI KARTI", "Kredi Kartı", "CARD", hatta "TEB". Serbest metni
 * olduğu gibi geçirirsek tahsilat kanalı seçimi sessizce boşa düşer.
 *
 * Tanımadığı değeri null yapar — yanlış kanala yazmaktansa kullanıcıya sordurur.
 */
const ODEME_KUMESI: FisOdemeSekli[] = ["NAKIT", "KREDI_KARTI", "YEMEK_KARTI", "HAVALE"]

export function normalizeOdeme(ham: unknown): FisOdeme | null {
  if (!ham || typeof ham !== "object") return null
  const o = ham as Record<string, unknown>
  const sade = String(o.sekil ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[^A-ZÇĞİÖŞÜ]/g, "")
  const eslesen = ODEME_KUMESI.find((k) => k.replace(/_/g, "") === sade) ?? null
  const tutar =
    typeof o.tutar === "number" && Number.isFinite(o.tutar) ? o.tutar : null
  return { sekil: eslesen, tutar }
}

/** Ham model çıktısını Fis[]'e indirir — şemayı yok sayan sağlayıcı düz dizi ya da tek fiş dönebilir. */
export function fislereIndir(ham: any): Fis[] {
  const fisler: Fis[] = Array.isArray(ham)
    ? ham
    : Array.isArray(ham?.fisler)
      ? ham.fisler
      : [ham]
  return fisler.map((f) => ({
    ...f,
    kalemler: Array.isArray(f.kalemler) ? f.kalemler : [],
    odeme: normalizeOdeme(f.odeme),
  }))
}

/**
 * Hazır (küçültülmüş) görselden fiş okur. Belge tarama boru hattı görseli bir
 * kez hazırlayıp sınıflandırıcıya ve buraya AYNI kareyi verir.
 */
export async function fisTaraHazir(
  jpeg: Buffer,
  secenek: { model?: string } = {}
): Promise<Omit<TaramaSonucu, "gorsel">> {
  const model = secenek.model || VARSAYILAN_MODEL
  const y = await modeleSor({
    model,
    sistem: TARAMA_PROMPT,
    icerik: [{ tip: "gorsel", jpeg }],
    komut: "Bu fişi çıkar.",
    semaAdi: "fis",
    sema: TARAMA_SEMA,
    baslik: "Kobipo fis tarama",
  })
  return {
    fisler: fislereIndir(y.ham),
    model,
    saglayici: y.saglayici,
    semaliydi: true,
    sureMs: y.sureMs,
    kullanim: y.kullanim,
  }
}

export async function fisTara(
  dosya: Buffer,
  secenek: { model?: string } = {}
): Promise<TaramaSonucu> {
  const g = await gorselHazirla(dosya)
  const sonuc = await fisTaraHazir(g.jpeg, secenek)
  return {
    ...sonuc,
    gorsel: { genislik: g.genislik, yukseklik: g.yukseklik, boyutKb: g.boyutKb },
  }
}
