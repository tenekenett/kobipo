import { describe, expect, it } from "vitest"
import { legacySlugify, looksLikeCuid, makeUniqueSlug, slugify } from "@/lib/slug"
import { TR_FOLD_FROM, TR_FOLD_TO } from "@/lib/text/tr-fold"

/**
 * `slugify` nöbetçisi.
 *
 * Asıl korunan değişmez: KATLAMA KÜÇÜLTMEDEN ÖNCE gelir. Sıra ters çevrilirse
 * `"İ".toLowerCase()` iki kod birimi ("i" + U+0307) üretir, birleşen nokta
 * `[^a-z0-9]` süzgecine takılır ve slug ortadan ikiye bölünür. Hata sessizdi:
 * kimse "i-zin" yazan bir adresi hata sanmaz.
 */
describe("slugify", () => {
  it("Türkçe büyük İ slug'ı BÖLMEZ", () => {
    expect(slugify("İzin")).toBe("izin")
    expect(slugify("İstifa Dilekçesi")).toBe("istifa-dilekcesi")
    expect(slugify("Yıllık İzin Talep Formu")).toBe("yillik-izin-talep-formu")
    expect(slugify("İŞ DÜNYASI")).toBe("is-dunyasi")
  })

  it("üretilen slug'da birleşen işaret (U+0307) kalmaz", () => {
    // Doğrudan ölçüm: hata tam olarak buydu.
    expect(slugify("İstanbul")).not.toContain("̇")
    expect([...slugify("İstanbul")].every((c) => /[a-z0-9-]/.test(c))).toBe(true)
  })

  it("tüm Türkçe harfleri sadeleştirir", () => {
    expect(slugify("Çiğdem Öztürk Şahin")).toBe("cigdem-ozturk-sahin")
    expect(slugify("ĞÜŞİÖÇ ğüşıöç")).toBe("gusioc-gusioc")
  })

  it("aksanlı harfler de sadeleşir (trFold yan kazancı)", () => {
    expect(slugify("Kâğıthane")).toBe("kagithane")
  })

  it("katlama tablosundaki hiçbir harf slug'a sızmaz", () => {
    // Tablo büyüyünce test kendiliğinden kapsar.
    for (const harf of TR_FOLD_FROM) {
      const sonuc = slugify(`a${harf}b`)
      expect(sonuc, `"${harf}" sadeleşmedi: ${sonuc}`).toMatch(/^[a-z0-9-]+$/)
    }
    expect(TR_FOLD_FROM.length).toBe(TR_FOLD_TO.length)
  })

  it("boş/simge girdide boş döner, kenar tireleri kırpar", () => {
    expect(slugify("")).toBe("")
    expect(slugify("   ")).toBe("")
    expect(slugify("!!!")).toBe("")
    expect(slugify("  --Merhaba--  ")).toBe("merhaba")
  })

  it("80 karakterle sınırlıdır", () => {
    expect(slugify("a".repeat(200))).toHaveLength(80)
  })
})

describe("legacySlugify", () => {
  it("ESKİ (hatalı) davranışı korur — yalnız geriye uyum eşleşmesi için", () => {
    // Bu bozuk çıktı KASITLI: dışarıda paylaşılmış eski adresler bununla eşleşiyor.
    expect(legacySlugify("İstifa Dilekçesi")).toBe("i-stifa-dilekcesi")
    expect(legacySlugify("İş Dünyası")).toBe("i-s-dunyasi")
  })

  it("İ içermeyen adlarda yeni slugify ile AYNI sonucu verir", () => {
    for (const ad of ["Muhasebe", "Stok Yönetimi", "e-Fatura", "Çağrı Merkezi"]) {
      expect(legacySlugify(ad), ad).toBe(slugify(ad))
    }
  })
})

describe("looksLikeCuid", () => {
  it("cuid'i tanır, slug'ı tanımaz", () => {
    expect(looksLikeCuid("cmoldruv20002ewu7rfvihqzy")).toBe(true)
    expect(looksLikeCuid("istifa-dilekcesi")).toBe(false)
    expect(looksLikeCuid("izin")).toBe(false)
  })
})

describe("makeUniqueSlug", () => {
  it("çakışmada sayaç ekler", async () => {
    const kullanilan = new Set(["izin", "izin-2"])
    const sonuc = await makeUniqueSlug("izin", async (c) => kullanilan.has(c))
    expect(sonuc).toBe("izin-3")
  })

  it("boş tabanda 'kayit' kullanır", async () => {
    expect(await makeUniqueSlug("", async () => false)).toBe("kayit")
  })
})
