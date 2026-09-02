/**
 * Model kataloğu — İSTEMCİ TARAFINDAN DA okunur, bu yüzden ayrı dosyada.
 *
 * `extract.ts` içinde dursaydı, model listesini gösteren ekran `sharp`'ı (yerel
 * ikili, yalnız node) tarayıcı paketine sürüklerdi ve derleme patlardı.
 */

/**
 * ÖLÇÜMLE seçildi (2026-09-02, üç fişli kare): Gemini ailesi kritik alanlarda
 * (VKN, tarih, toplam, KDV) %100 aldı; Qwen2.5-VL KDV'yi KDV-dahil toplamın
 * üstüne ekledi (525,58 -> 613,18) ve bir TCKN'yi tümden kaçırdı.
 *
 * 3.7-flash, 2.5-flash'a göre ~5 kat pahalı ama fark firma başına ayda sentlerle
 * ölçülüyor; karşılığında ölçemediğimiz zor fotoğraflar için pay bırakıyor.
 *
 * DÜŞÜNMEYİ KISMA: `reasoning.effort = "low"` maliyeti yarıya indiriyor ama
 * ölçümde VKN'yi fişteki MERSIS numarasından yanlış hane penceresiyle okudu
 * (6600049438 yerine 6600004943). Üstelik o yanlış numara checksum'ı geçiyor.
 */
export const VARSAYILAN_MODEL = "google/gemini-3.7-flash"

export const DENENEBILIR_MODELLER = [
  { id: "google/gemini-3.7-flash", etiket: "Gemini 3.7 Flash (varsayılan)" },
  { id: "google/gemini-2.5-flash", etiket: "Gemini 2.5 Flash (ucuz)" },
  { id: "google/gemini-3.5-flash-lite", etiket: "Gemini 3.5 Flash Lite (hızlı)" },
  { id: "google/gemini-3.1-flash-lite", etiket: "Gemini 3.1 Flash Lite" },
  { id: "qwen/qwen3-vl-235b-a22b-instruct", etiket: "Qwen3-VL 235B (yavaş)" },
  { id: "qwen/qwen2.5-vl-72b-instruct", etiket: "Qwen2.5-VL 72B (ölçümde en kötü)" },
]
