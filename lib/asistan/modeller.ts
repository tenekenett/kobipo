/**
 * Sohbet modeli kataloğu — İSTEMCİ TARAFINDAN DA okunur, bu yüzden ayrı dosyada
 * (fiş taramadaki `lib/fis-ocr/models.ts` ile aynı gerekçe: sohbet modülü
 * Prisma'yı içe aktarıyor, model listesini gösteren ekran onu tarayıcı paketine
 * sürüklerdi).
 *
 * VARSAYILAN HENÜZ ÖLÇÜLMEDİ. Fiş taramada model, üç fişlik bir kareyle
 * ölçülerek seçilmişti; burada da aynı yol izlenecek — `scripts/asistan-olcum.mjs`
 * sabit soru setini her modele sorar, cevabı DETERMİNİSTİK beklenen değerle
 * karşılaştırır. Ölçüm bitene kadar aşağıdaki sıra bir TAHMİNDİR, sonuç değil;
 * seçim gerekçesi ölçümden sonra bu yorumun yerine yazılacak.
 *
 * Ölçütler (`docs/asistan/OLCUM.md`):
 *   1. Rakam sadakati — araç sonucundaki sayıyı değiştirmeden mi söylüyor?
 *   2. Halüsinasyon   — aracın dönmediği bir rakamı uyduruyor mu?
 *   3. Araç seçimi    — doğru aracı, doğru parametreyle, kaç turda çağırdı?
 *   4. Maliyet/süre   — sağlayıcının bildirdiği gerçek maliyet.
 */

export const VARSAYILAN_MODEL = "anthropic/claude-sonnet-5"

export const DENENEBILIR_MODELLER = [
  { id: "anthropic/claude-opus-5", etiket: "Claude Opus 5 (en güçlü)" },
  { id: "anthropic/claude-sonnet-5", etiket: "Claude Sonnet 5 (varsayılan)" },
  { id: "google/gemini-3.7-flash", etiket: "Gemini 3.7 Flash (fiş taramanın modeli)" },
  { id: "google/gemini-2.5-flash", etiket: "Gemini 2.5 Flash (en ucuz)" },
]

export function modelGecerliMi(id: string | null | undefined): boolean {
  return Boolean(id && DENENEBILIR_MODELLER.some((m) => m.id === id))
}
