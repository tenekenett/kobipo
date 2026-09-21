/**
 * MENÜ çıkarımı — kafe/restoran menüsünün bir SAYFASI. Bölüm başlıkları, kalem
 * adı, fiyat(lar), açıklama, para birimi, KDV notu. Reçete/alerjen/kalori
 * okunmaz (plan §1.2).
 *
 * Şema strict json_schema: her alan `required`, null'a izin verilenler açıkça
 * `["tip","null"]`. Sağlayıcı şemayı yok sayabilir; `normalize.ts` her alanı
 * güvenli tipe indirir.
 */

export const MENU_SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bolumler", "kalemler", "kdvNotu", "paraBirimi", "guven"],
  properties: {
    bolumler: {
      type: "array",
      description: "Sayfadaki bölüm başlıkları, menüdeki sırayla (SICAK İÇECEKLER, TATLILAR...)",
      items: { type: "string" },
    },
    kalemler: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ad", "aciklama", "bolum", "fiyatlar"],
        properties: {
          ad: { type: "string", description: "ürün adı, menüde yazıldığı gibi" },
          aciklama: { type: ["string", "null"], description: "adın altındaki içerik/açıklama metni; yoksa null" },
          bolum: { type: ["string", "null"], description: "kalemin altında durduğu bölüm başlığı; sayfa başlıksız başlıyorsa null" },
          fiyatlar: {
            type: "array",
            description: "menüde yazan fiyat(lar); çok sütunlu satırda sütun sırasıyla",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["etiket", "fiyat"],
              properties: {
                etiket: { type: ["string", "null"], description: "sütun/varyant adı: Küçük, Büyük, S, M, L, Tek, Duble, 33cl...; tek fiyatta null" },
                fiyat: { type: ["number", "null"], description: "sayı; okunamadıysa null" },
              },
            },
          },
        },
      },
    },
    kdvNotu: { type: ["string", "null"], description: "menüdeki KDV/servis notu, olduğu gibi; yoksa null" },
    paraBirimi: { type: ["string", "null"], description: "TRY, USD, EUR; simge yoksa null" },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["kalemler", "fiyatlar", "bolumler"],
      properties: { kalemler: { type: "number" }, fiyatlar: { type: "number" }, bolumler: { type: "number" } },
    },
  },
} as const

export const MENU_PROMPT = [
  "Sen Türk kafe ve restoran menülerini (basılı menü fotoğrafı, tasarımcı PDF'i, tahta menü)",
  "okuyan bir veri çıkarma aracısın. Sana menünün BİR sayfası verilir.",
  "",
  "- Her satılan kalemi 'kalemler' listesine yaz: ad, varsa açıklama, bağlı olduğu bölüm, fiyat(lar).",
  "- BÖLÜM BAŞLIKLARI kalem DEĞİLDİR: 'TATLILAR', 'SICAK İÇECEKLER' gibi fiyatsız başlıkları",
  "  yalnız 'bolumler' listesine ve kalemlerin 'bolum' alanına yaz; kalem olarak EKLEME.",
  "- Fiyat KDV DAHİL yazılır; sayı olarak ver: '120', '120,00', '120 TL', '₺120', '120.-' -> 120.",
  "  '1.250' Türk biçiminde bin ayracıdır -> 1250. Fiyat aralığı (90-110) verilmişse iki fiyat yaz.",
  "- Çok sütunlu satır (Küçük/Orta/Büyük, S/M/L, Tek/Duble, 33cl/50cl, Sıcak/Soğuk): her sütunu",
  "  ayrı fiyat olarak, sütun başlığını 'etiket'e yazarak ver. Sütun başlığı bölümün üstünde",
  "  duruyorsa o bölümdeki tüm satırlara aynı etiketleri uygula. Tek fiyatlı satırda etiket null.",
  "- İKİ KOLONLU sayfalarda ad ile fiyatı AYNI SATIRDAN eşle; sol kolonun fiyatını sağ kolona kaydırma.",
  "- Açıklama metni (içindekiler, gramaj) 'aciklama'ya; ürün adına EKLEME.",
  "- Okuyamadığın fiyatı null bırak, UYDURMA. Sayfada kalem yoksa boş liste dön.",
  "- 'kdvNotu': menü dibindeki 'Fiyatlarımıza KDV dahildir' gibi notu olduğu gibi yaz.",
  "- 'paraBirimi': ₺/TL -> TRY, $ -> USD, € -> EUR; simge yoksa null.",
  '- "guven": 0-1; okunaksız, eğik ya da yansımalı fotoğrafta düşük ver.',
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const MENU_KOMUT = "Bu menü sayfasını çıkar."
