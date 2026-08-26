// İndirim kodu METNİNİN normalize edilmesi — istemci ve sunucu ORTAK.
//
// Ayrı (prisma'sız) dosyada: sistem-admin formu da aynı çevrimi yapmalı ki panelde
// görünen kod ile kullanıcının yazdığında bulunacak kod aynı olsun. lib/billing/
// discount.ts prisma'yı içeri çektiği için istemciden import edilemez.

/**
 * TÜRKÇE BÜYÜK HARF TUZAĞI: `toLocaleUpperCase("tr-TR")` "i" harfini "İ" yapar.
 * Panelde ASCII yazılmış "MIN1000" kodunu kullanıcı "min1000" diye girdiğinde
 * "MİN1000" çıkar ve kod BULUNAMAZ — kupon sessizce çalışmaz (2026-08-26'da
 * tarayıcı testinde yakalandı). Bu yüzden çevrim YEREL-BAĞIMSIZDIR ve Türkçe
 * harfler ASCII'ye indirgenir; kod alfabesi zaten ASCII'dir.
 */
const TR_TO_ASCII: Record<string, string> = {
  İ: "I", ı: "I", Ş: "S", ş: "S", Ğ: "G", ğ: "G",
  Ü: "U", ü: "U", Ö: "O", ö: "O", Ç: "C", ç: "C",
}

export function normalizeDiscountCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/[İıŞşĞğÜüÖöÇç]/g, (ch) => TR_TO_ASCII[ch] ?? ch)
    .toUpperCase()
}
