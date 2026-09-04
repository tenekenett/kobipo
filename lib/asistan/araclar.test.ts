/**
 * Asistanın YETKİ KAPISI testleri.
 *
 * Buradaki risk diğer sayfa kapılarından farklı ve daha sinsi: asistan, sayfa
 * yetkilendirmesinin ETRAFINDAN DOLAŞAN bir kanal olmaya çok müsait. Kullanıcı
 * panelde kâr marjını göremiyorsa asistana sorarak da öğrenememeli — ama bunu
 * bozmak için kod yazmak gerekmiyor, sadece yeni bir araca kapı koymayı unutmak
 * yetiyor. O yüzden "her aracın kapısı var mı" ayrıca sınanıyor.
 *
 * Modele araç LİSTESİ de kapıdan geçirilerek veriliyor; kapalı bir aracın adını
 * modelin hiç görmemesi lazım, yoksa "şunu çağırayım" deyip hata alıyor ve
 * kullanıcıya "veri yok" diye yanlış cevap verebiliyor.
 */

import { describe, expect, it } from "vitest"
import { acikAraclar, aracCalistir, aracSemalari, type AracBaglami } from "./araclar"
import type { PagePermissions } from "@/lib/page-access"

const ADMIN: PagePermissions = { role: "ADMIN", allowedPaths: [], writablePaths: [] }

/** Yalnız stok ekranlarını görebilen kısıtlı çalışan. */
const SADECE_STOK: PagePermissions = {
  role: "STOCK",
  allowedPaths: ["/stok/urunler"],
  writablePaths: [],
}

const baglam = (izinler: PagePermissions, kapaliModuller: string[] = []): AracBaglami => ({
  companyId: "test-firma",
  izinler,
  kapaliModuller,
})

describe("araç kapısı", () => {
  it("yönetici bütün araçları görür", () => {
    const adlar = acikAraclar(baglam(ADMIN)).map((a) => a.ad)
    expect(adlar).toContain("urun_ara")
    expect(adlar).toContain("donem_ozeti")
    expect(adlar).toContain("vadesi_gecenler")
    expect(adlar).toContain("nakit_durumu")
  })

  it("kısıtlı çalışana yalnız izinli sayfanın araçları verilir", () => {
    const adlar = acikAraclar(baglam(SADECE_STOK)).map((a) => a.ad)
    expect(adlar).toContain("urun_ara")
    expect(adlar).toContain("kritik_stok")
    // Rapor ve finans sayfalarını göremiyor: kâr ve cari verisi de kapalı.
    expect(adlar).not.toContain("donem_ozeti")
    expect(adlar).not.toContain("vadesi_gecenler")
    expect(adlar).not.toContain("nakit_durumu")
  })

  it("kapalı modülün aracı hiç görünmez", () => {
    const adlar = acikAraclar(baglam(ADMIN, ["stock"])).map((a) => a.ad)
    expect(adlar).not.toContain("urun_ara")
    expect(adlar).not.toContain("hareketsiz_stok")
    // Stok kapalı ama finans açık.
    expect(adlar).toContain("nakit_durumu")
  })

  it("modele bildirilen şema listesi kapıdan geçmiş listeyle aynı", () => {
    const b = baglam(SADECE_STOK)
    const semaAdlari = aracSemalari(b).map((s) => s.function.name)
    expect(semaAdlari).toEqual(acikAraclar(b).map((a) => a.ad))
  })
})

describe("kapalı araç çağrılırsa", () => {
  it("veri dönmez, açık bir yetki hatası döner", async () => {
    // Model kapalı aracın adını uydursa bile (ya da eski bir sohbetten
    // hatırlasa) çalıştırma kapıda durur.
    const sonuc = await aracCalistir("nakit_durumu", {}, baglam(SADECE_STOK))
    expect(sonuc.cikti).toMatchObject({ hata: expect.stringContaining("yetkiniz yok") })
  })

  it("olmayan araç sessizce boş sonuç değil, hata döndürür", async () => {
    const sonuc = await aracCalistir("cariyi_sil", {}, baglam(ADMIN))
    expect(sonuc.cikti).toMatchObject({ hata: expect.stringContaining("Böyle bir araç yok") })
  })
})

describe("araç kümesi", () => {
  it("yazan araç YOKTUR", () => {
    // Asistanın gördüğü veri serbest metin içeriyor (ürün adı, fatura notu) ve
    // oraya talimat yazılabilir. Tek gerçek savunma: silen/değiştiren bir aracın
    // hiç var olmaması. Bu test o sınırın bekçisi.
    const yasakli = /(sil|kaydet|guncelle|güncelle|olustur|oluştur|ekle|yaz|gonder|gönder)/i
    for (const arac of acikAraclar(baglam(ADMIN))) {
      expect(arac.ad, `${arac.ad} yazma çağrıştırıyor`).not.toMatch(yasakli)
    }
  })

  it("her aracın bir kapısı var", () => {
    for (const arac of acikAraclar(baglam(ADMIN))) {
      expect(arac.kapi.sayfa, `${arac.ad} sayfa kapısı taşımıyor`).toBeTruthy()
      expect(arac.kapi.modul, `${arac.ad} modül kapısı taşımıyor`).toBeTruthy()
    }
  })
})
