/**
 * Belgeye giren HER kullanıcı metni buradan geçer.
 *
 * Neden: akış motoru satırı yalnız BOŞLUKTAN bölebilir. Boşluksuz uzun bir jeton
 * (ürün kodu, IBAN, URL, e-posta, yapıştırılmış açıklama) hücreye sığmaz ve
 * hücreyi genişleterek KOMŞU KOLONLARI iter — kullanıcı bunu "bazen tutar
 * kayıyor" diye görür. Ölçüldü: 140 karakterlik boşluksuz kod, 210mm'lik sayfada
 * metni 454mm'ye taşırıp sağdaki bilgi bloğunu 498mm'ye itiyordu.
 *
 * Çözüm: uzun jetonların içine SIFIR GENİŞLİKLİ bölme fırsatı (U+200B) serpmek.
 * Görünürde hiçbir şey değişmez (glif çizilmez), ama motor gerektiğinde oradan
 * satır atlar. Önce doğal sınırlar (noktalama) denenir; kalan uzun parçalar sabit
 * aralıkla bölünür.
 */

/** U+200B — sıfır genişlikli boşluk. Kaçış dizisiyle yazılır ki kaynakta
 *  görünmez karakter durmasın (kopyala-yapıştırda sessizce kaybolur). */
export const ZWSP = String.fromCharCode(0x200b)

/** Noktalamadan sonra bölme fırsatı verilebilecek karakterler. */
const BREAK_AFTER = /[/\\\-_.,:;@&+=|>)\]}]/

/**
 * Metni satır sonu için güvenli hale getirir.
 *
 * @param maxRun Bölme fırsatı olmadan izin verilen en uzun karakter dizisi.
 *   Varsayılan 12: en dar kolonumuz (~14mm) 8.5pt ile yaklaşık bu kadar karakter
 *   alır; daha büyük değer dar kolonlarda taşmayı geri getirir.
 */
export function softBreak(value: string | null | undefined, maxRun = 12): string {
  if (!value) return ""
  const text = String(value)
  if (text.length <= maxRun) return text

  let out = ""
  let sinceBreak = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    out += ch

    if (/\s/.test(ch) || ch === ZWSP) {
      sinceBreak = 0
      continue
    }

    sinceBreak++

    // Doğal sınır: noktalamadan SONRA böl (bir sonraki karakter boşluk değilse).
    if (BREAK_AFTER.test(ch) && sinceBreak >= 4 && i + 1 < text.length && !/\s/.test(text[i + 1])) {
      out += ZWSP
      sinceBreak = 0
      continue
    }

    // Doğal sınır yoksa sabit aralıkla böl.
    if (sinceBreak >= maxRun && i + 1 < text.length && !/\s/.test(text[i + 1])) {
      out += ZWSP
      sinceBreak = 0
    }
  }

  return out
}

/** Ölçüm/karşılaştırma için: eklenen bölme işaretlerini geri sök. */
export function stripSoftBreaks(value: string): string {
  return value.split(ZWSP).join("")
}
