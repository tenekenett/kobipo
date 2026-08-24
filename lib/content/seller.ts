/**
 * SATICI (Kobipo'yu işleten tüzel kişi) künyesi — yasal sayfaların TEK kaynağı.
 *
 * Neden tek yerde: mesafeli satış sözleşmesi, iptal/iade, teslimat ve iletişim
 * sayfalarının hepsi aynı ünvan/VKN/adresi göstermek zorunda. Sayfalara ayrı ayrı
 * yazılırsa biri güncellenip diğerleri unutulur ve belgeler arasında çelişki doğar —
 * ödeme kuruluşu incelemesinde de, GİB tarafında da sorun çıkarır.
 *
 * Bu künye, faturayı kesen firmayla (lib/invoicing/config.ts → satıcı firma,
 * VKN 7352344835) AYNI tüzel kişiyi tanımlar. Biri değişirse diğeri de değişmeli.
 */
export const SELLER = {
  title: "REYPO BİLİŞİM SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
  brand: "Kobipo",
  address: "Kınıklı Mah. 6040 Sok. No:6/5 Pamukkale / Denizli",
  city: "Denizli",
  taxOffice: "Pamukkale",
  taxNumber: "7352344835",
  phone: "0532 273 65 20",
  email: "destek@reypo.com.tr",
  supportEmail: "destek@kobipo.com",
  /** Yetkili mahkeme/icra dairesi (tüketici olmayan alıcılar için). */
  jurisdiction: "Denizli",
  /** Kartlı ödemeleri yürüten ödeme kuruluşunun yasal ünvanı. */
  paymentProvider: "PayTR Ödeme ve Elektronik Para Kuruluşu A.Ş.",

  // TODO(kobipo): Aşağıdaki iki alan elde yok — ticaret sicil kayıtlarından doldurun.
  // Boş bırakıldıkları sürece sayfalarda GÖSTERİLMEZ (yanlış değer basmaktansa
  // hiç basmamak doğrudur), ancak e-ticaret mevzuatı bunları istemektedir.
  mersis: "",
  tradeRegistryNo: "",
} as const
