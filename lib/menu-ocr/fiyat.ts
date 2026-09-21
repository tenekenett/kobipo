/**
 * KDV ve fiyat çevrimi + varyant → seçenek grubu (plan §3.5, §3.6). Saf,
 * istemcide de koşar (kullanıcı satırda oranı değiştirince net yeniden hesaplanır).
 *
 * İKİ KONVANSİYON YAN YANA (plan §2):
 *   Product.salePrice        → NET  (KDV hariç), Decimal(15,6)
 *   ProductOption.priceDelta → BRÜT (KDV dahil fark), Decimal(12,2)
 * Menüde yazan her rakam BRÜT'tür. Çevrim yalnız burada yapılır; karıştırılırsa
 * büyük boy kahve sessizce yanlış fiyatlanır.
 */

import { trFold } from "@/lib/text/tr-fold"
import type { MenuFiyat, SecenekGrubuOnerisi } from "./turler"

/** Oturum varsayılanı: gıda/içecek %10. Alkollü başlıklarda sözlük %20 önerir. */
export const VARSAYILAN_KDV = 10
export const KDV_ORANLARI = [0, 1, 10, 20] as const

/**
 * Sorgu/form paramından oran: yoksa ya da boşsa null (çağıran varsayılanı koyar).
 * `Number(null)` ve `Number("")` 0 döner ve 0 GEÇERLİ bir orandır — doğrudan
 * Number() ile okunan eksik param "%0 seçildi" sayılıp tüm yeni ürünleri
 * net=brüt yazdırıyordu. 0–100 dışı da null (uç 400 vermez, varsayılana düşer).
 */
export function kdvOraniOku(ham: unknown): number | null {
  if (ham == null) return null
  const s = String(ham).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

const yuvarla = (n: number, ondalik: number) => {
  const c = 10 ** ondalik
  return Math.round(n * c) / c
}

/** KDV dahil → net (6 ondalık, Product.salePrice hassasiyeti). */
export function netFiyat(brut: number, kdvOrani: number): number {
  if (!(kdvOrani > 0)) return yuvarla(brut, 6)
  return yuvarla(brut / (1 + kdvOrani / 100), 6)
}

/** Net → KDV dahil (2 ondalık, menüdeki rakam). */
export function brutFiyat(net: number, kdvOrani: number): number {
  if (!(kdvOrani > 0)) return yuvarla(net, 2)
  return yuvarla(net * (1 + kdvOrani / 100), 2)
}

/**
 * Alkollü içecek başlıkları %20 — menüdeki bölüm ya da ürün adında geçerse.
 * Sözlük kısa tutuldu: yanlış pozitif (%20 önerilen çay) kullanıcıya görünür ve
 * düzeltilir; yanlış negatif (%10'la kaydedilen bira) beyannameye kadar görünmez.
 */
const ALKOL = ["bira", "sarap", "sarab", "kokteyl", "raki", "viski", "votka", "cin ", "likor", "tekila", "rom ", "alkol", "prosecco", "sampanya", "mojito", "margarita", "aperol", "gin"]

export function kdvOnerisi(bolum: string | null, ad: string, oturumOrani: number): number {
  const metin = ` ${trFold(bolum ?? "")} ${trFold(ad)} `
  // "cin" ve "rom" kısa; boşlukla sınırlandı ki "cinnamon"/"romantik" yakalanmasın.
  if (ALKOL.some((k) => metin.includes(k.endsWith(" ") ? ` ${k}` : k))) return 20
  return oturumOrani
}

/** Etiket sözlüğü → grup adı. Sıra önemli: "büyük boy sıcak" boy sayılsın. */
const BOY = ["kucuk", "orta", "buyuk", "s", "m", "l", "xl", "small", "medium", "large", "tek", "duble", "cift", "mini", "grande", "venti", "tall", "regular", "jumbo", "porsiyon", "yarim", "tam", "buyukboy", "kucukboy"]
const SERVIS = ["sicak", "soguk", "ice", "buzlu", "hot", "cold", "frozen"]
const HACIM = /^\d+\s*(cl|ml|lt|l|gr|g|kg|cc)$/

function etiketAnahtari(e: string | null): string {
  return trFold(e ?? "").replace(/[^a-z0-9]/g, "")
}

export function grupAdiTuret(etiketler: Array<string | null>): { ad: string; taninmadi: boolean } {
  const anahtarlar = etiketler.map(etiketAnahtari).filter(Boolean)
  if (anahtarlar.length === 0) return { ad: "Seçenek", taninmadi: true }
  if (anahtarlar.every((a) => BOY.includes(a) || HACIM.test(a))) return { ad: "Boy", taninmadi: false }
  if (anahtarlar.every((a) => SERVIS.includes(a))) return { ad: "Servis", taninmadi: false }
  return { ad: "Seçenek", taninmadi: true }
}

/**
 * Çok fiyatlı satır → tek ürün + seçenek grubu (karar A). Taban = EN DÜŞÜK
 * fiyat (varsayılan şık, delta 0); diğer şıklar tabana göre KDV DAHİL fark.
 * Tek fiyatlı satırda null. Reçete çarpanı bu fazda YAZILMAZ.
 *
 * Etiketsiz fiyatlar (model sütun başlığını okuyamadı) şık adını fiyattan alır
 * ("110 ₺"); kullanıcı kartta düzeltir — ad UYDURULMAZ ("Orta" denmez).
 */
export function secenekGrubuTuret(fiyatlar: MenuFiyat[]): SecenekGrubuOnerisi | null {
  if (fiyatlar.length < 2) return null
  const sirali = [...fiyatlar].sort((a, b) => a.fiyat - b.fiyat)
  const taban = sirali[0].fiyat
  const { ad, taninmadi } = grupAdiTuret(fiyatlar.map((f) => f.etiket))
  const etiketsiz = fiyatlar.some((f) => !f.etiket)
  const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`
  return {
    ad,
    etiketTaninmadi: taninmadi || etiketsiz,
    secenekler: sirali.map((f, i) => ({
      ad: f.etiket ?? tl(f.fiyat),
      priceDelta: yuvarla(f.fiyat - taban, 2),
      isDefault: i === 0,
    })),
  }
}

/** Çok fiyatlı satırın taban (en düşük) brüt fiyatı. */
export function tabanBrut(fiyatlar: MenuFiyat[]): number {
  return Math.min(...fiyatlar.map((f) => f.fiyat))
}
