// KART METİNLERİ — kullanıcının okuduğu cümlelerin nöbetçisi.
//
// Kartların metni tek bir şablon değil: her kartın iki-üç DALI var ve dallar
// canlı veride bulunan uç durumlardan doğdu. Örnekler:
//   • boş adisyona "satışı rapora girmedi" demek (satış YOK)
//   • iadeler yüzünden neti eksiye düşen belgeye "3 fatura -₺2.693" demek
//   • altı alış belgesi olan firmaya "hiç alış faturası yok" demek
//   • süresi tamamen dolmuş kuyruğa "N gün kaldı" demek
// Dördü de yazım sırasında ya da tarayıcı denetiminde yakalandı ve elle
// düzeltildi. Elle yakalanan şey, ikinci kez elle yakalanmayı bekler — bu dosya
// o dalları tutuyor.
//
// Testler CÜMLENİN TAMAMINI değil, dalın AYIRT EDİCİ parçasını sınar: metin
// güzelleştirilebilsin, ama "hangi durumda ne söylendiği" değişmesin.

import { describe, expect, it } from "vitest"
import {
  acikAdisyonKarti,
  donmeyenMusteriKarti,
  gonderilemeyenKarti,
  kdvDonemiKarti,
  tersBakiyeKarti,
  yanitBekleyenKarti,
  yogunlasmaKarti,
} from "./kartlar"
import type { TersBakiyeCarisi, TersBakiyeOzeti } from "./veri/ters-bakiye"

const FIRMA = "firma-1"

// ── K-THS-08 / K-TDR-05 ─────────────────────────────────────────────────────

const cari = (over: Partial<TersBakiyeCarisi> = {}): TersBakiyeCarisi => ({
  id: "c1",
  slug: "cari-1",
  ad: "Örnek Cari",
  yetkili: "Yetkili",
  telefon: "0555",
  tutar: 100_000,
  faturaAdet: 2,
  faturaToplam: 50_000,
  ciftRol: false,
  ...over,
})

const tersOzet = (over: Partial<TersBakiyeOzeti> = {}): TersBakiyeOzeti => ({
  yon: "musteri",
  adet: 1,
  faturasizAdet: 0,
  enBuyuk: 100_000,
  ciftRolVar: false,
  ornekler: [cari()],
  ...over,
})

describe("K-THS-08 / K-TDR-05 metni", () => {
  it("yön kodu belirler: müşteri K-THS-08, tedarikçi K-TDR-05", () => {
    expect(tersBakiyeKarti(FIRMA, tersOzet()).kod).toBe("K-THS-08")
    expect(tersBakiyeKarti(FIRMA, tersOzet({ yon: "tedarikci" })).kod).toBe("K-TDR-05")
  })

  it("HİÇ faturası olmayan caride başlık 'karşılığında fatura yok' der", () => {
    const kart = tersBakiyeKarti(
      FIRMA,
      tersOzet({ faturasizAdet: 1, ornekler: [cari({ faturaAdet: 0, faturaToplam: 0 })] })
    )
    expect(kart.baslik).toContain("kesilmiş tek bir fatura yok")
    expect(kart.gerekce).toContain("hiç fatura yok")
    // Faturasız vaka en güçlü hâl: kademe yükselir.
    expect(kart.onem).toBe("yuksek")
  })

  it("faturası olan caride başlık 'faturaların üstünde' der ve kademe düşer", () => {
    const kart = tersBakiyeKarti(FIRMA, tersOzet())
    expect(kart.baslik).toContain("üstünde")
    expect(kart.onem).toBe("orta")
  })

  it("iadeler neti eksiye düşürdüyse metin bunu SÖYLER, '2 fatura -₺X' demez", () => {
    const kart = tersBakiyeKarti(
      FIRMA,
      tersOzet({ yon: "tedarikci", ornekler: [cari({ faturaAdet: 3, faturaToplam: -2_693 })] })
    )
    expect(kart.gerekce).toContain("iadelerden sonra net")
    expect(kart.gerekce).not.toMatch(/3 fatura -/)
  })

  it("tek cari varsa karşı taraf bloğu dolar, birden çoksa DOLMAZ", () => {
    expect(tersBakiyeKarti(FIRMA, tersOzet()).karsiTaraf?.telefon).toBe("0555")
    const cok = tersBakiyeKarti(
      FIRMA,
      tersOzet({ adet: 2, ornekler: [cari(), cari({ id: "c2", ad: "İkinci" })] })
    )
    expect(cok.karsiTaraf).toBeUndefined()
    expect(cok.baslik).toContain("2 ")
  })

  it("çift rol notu YALNIZ çift rollü caride eklenir", () => {
    const sade = tersBakiyeKarti(FIRMA, tersOzet())
    expect(sade.gerekce).not.toContain("mahsuplaşmaz")

    const isaretli = tersBakiyeKarti(FIRMA, tersOzet({ ciftRolVar: true }))
    expect(isaretli.gerekce).toContain("mahsuplaşmaz")
  })

  it("kart hangi bakiyeyi söylediğini yazar — ekstre 2026-09-08'de hizalandı", () => {
    const kart = tersBakiyeKarti(FIRMA, tersOzet())
    expect(kart.gerekce).toContain("cari listesindeki bakiyedir")
    expect(kart.gerekce).toContain("ekstrede de aynı rakam")
  })
})

// ── K-OPR-06 ────────────────────────────────────────────────────────────────

describe("K-OPR-06 metni", () => {
  const adisyon = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    kod: "ADS-1",
    masa: "M1",
    gun: 19,
    tutar: 0,
    kalemAdet: 0,
    ...over,
  })

  it("BOŞ masaya 'satışı rapora girmedi' DENMEZ — ortada satış yok", () => {
    const kart = acikAdisyonKarti(FIRMA, {
      adet: 1,
      enUzunGun: 19,
      toplamTutar: 0,
      bosAdet: 1,
      ornekler: [adisyon()],
    })
    expect(kart.baslik).toContain("hiç kalem girilmemiş")
    expect(kart.baslik).not.toContain("rapora girmedi")
    expect(kart.gerekce).toContain("kaybolan ciro yok")
  })

  it("kalemi olan masada sonuç CİRODUR ve stok da söylenir", () => {
    const kart = acikAdisyonKarti(FIRMA, {
      adet: 1,
      enUzunGun: 31,
      toplamTutar: 3_231,
      bosAdet: 0,
      ornekler: [adisyon({ tutar: 3_231, kalemAdet: 2 })],
    })
    expect(kart.baslik).toContain("rapora girmedi")
    expect(kart.gerekce).toContain("ciroya girmedi")
    expect(kart.gerekce).toContain("stoktan düşmedi")
  })

  it("karışık kümede boş adisyonlar AYRI cümlede sayılır", () => {
    const kart = acikAdisyonKarti(FIRMA, {
      adet: 4,
      enUzunGun: 32,
      toplamTutar: 6_832,
      bosAdet: 1,
      ornekler: [adisyon({ tutar: 3_231, kalemAdet: 1 }), adisyon({ id: "t2", kod: "ADS-2" })],
    })
    expect(kart.gerekce).toContain("1 adisyonda hiç kalem yok")
    expect(kart.baslik).toContain("4 adisyon")
  })
})

// ── K-BLG-08 ────────────────────────────────────────────────────────────────

describe("K-BLG-08 metni", () => {
  const fatura = (over: Record<string, unknown> = {}) => ({
    uuid: "u1",
    no: "FT-1",
    gonderen: "Gönderen",
    gun: 7,
    kalanGun: 1,
    tutar: 1_412_400,
    tl: true,
    ...over,
  })

  it("süresi işleyen faturada SON TARİH ve kalan gün yazılır", () => {
    const kart = yanitBekleyenKarti(FIRMA, {
      adet: 1,
      acikAdet: 1,
      gecmisAdet: 0,
      enYakinKalan: 1,
      enEskiGun: 7,
      tutarTL: 1_412_400,
      dovizAdet: 0,
      ekranDonemi: 30,
      ornekler: [fatura()],
    })
    expect(kart.baslik).toContain("1 gün kaldı")
    expect(kart.sonTarih).toContain("1 gün kaldı")
    expect(kart.onem).toBe("kritik")
  })

  it("son günde 'bugün son gün' denir", () => {
    const kart = yanitBekleyenKarti(FIRMA, {
      adet: 1,
      acikAdet: 1,
      gecmisAdet: 0,
      enYakinKalan: 0,
      enEskiGun: 8,
      tutarTL: 1_000,
      dovizAdet: 0,
      ekranDonemi: 30,
      ornekler: [fatura({ kalanGun: 0 })],
    })
    expect(kart.baslik).toContain("bugün son gün")
    expect(kart.sonTarih).toContain("Bugün son gün")
  })

  it("tamamı süresi dolmuş kuyrukta DİL DEĞİŞİR: son tarih yok, kayıt işi var", () => {
    const kart = yanitBekleyenKarti(FIRMA, {
      adet: 36,
      acikAdet: 0,
      gecmisAdet: 36,
      enYakinKalan: null,
      enEskiGun: 52,
      tutarTL: 174_625,
      dovizAdet: 0,
      ekranDonemi: 90,
      ornekler: [fatura({ kalanGun: -44, gun: 52 })],
    })
    expect(kart.baslik).toContain("kabul edilmiş sayılıyorlar")
    // "yanıtsız kaldı" meşru; yasak olan "N gün kaldı" — süresi dolmuş kuyrukta
    // geriye sayılacak bir şey yok.
    expect(kart.baslik).not.toMatch(/gün kaldı|bugün son gün/)
    expect(kart.sonTarih).toContain("Red süresi doldu")
    expect(kart.onem).toBe("orta")
  })

  it("döviz faturası varsa TL toplamına katılmadığı söylenir", () => {
    const kart = yanitBekleyenKarti(FIRMA, {
      adet: 2,
      acikAdet: 2,
      gecmisAdet: 0,
      enYakinKalan: 3,
      enEskiGun: 5,
      tutarTL: 1_000,
      dovizAdet: 1,
      ekranDonemi: 7,
      ornekler: [fatura({ kalanGun: 3 })],
    })
    expect(kart.gerekce).toContain("döviz faturası")
  })
})

// ── K-BLG-07 ────────────────────────────────────────────────────────────────

describe("K-BLG-07 metni", () => {
  const donem = (over: Record<string, unknown> = {}) => ({
    donem: "2026-08",
    donemAdi: "Ağustos 2026",
    kalanGun: 8,
    beyanTarihi: "28 Eylül",
    hesaplananKdv: 244_316,
    indirilecekKdv: 168_650,
    fark: 75_666,
    satisAdet: 42,
    alisAdet: 4,
    kacanAdet: 62,
    kacanKdv: 24_727,
    kacanEnBuyuk: 1_000,
    ...over,
  })

  it("beyanname olmadığı HER ZAMAN yazılır", () => {
    const kart = kdvDonemiKarti(FIRMA, donem())
    expect(kart.gerekce).toContain("Bu bir beyanname değildir")
    expect(kart.gerekce).toContain("devreden KDV")
  })

  it("alış BELGESİ olduğu hâlde net indirim eksiyse 'hiç belge yok' DENMEZ", () => {
    // Canlı vaka: 6 alış belgesi, iadeler yüzünden net −₺155.
    const kart = kdvDonemiKarti(FIRMA, donem({ alisAdet: 6, indirilecekKdv: -155, fark: 4_463 }))
    expect(kart.gerekce).toContain("6 alış belgesi var")
    expect(kart.gerekce).not.toContain("tek bir alış faturası yok")
  })

  it("hiç alış belgesi yoksa bunu açıkça söyler", () => {
    const kart = kdvDonemiKarti(FIRMA, donem({ alisAdet: 0, indirilecekKdv: 0 }))
    expect(kart.gerekce).toContain("tek bir alış faturası yok")
  })

  it("KDV'si SIFIR olan belgeler de belgedir — ölçü tutar değil, ADETTİR", () => {
    // İstisna/%0 KDV'li üç alış: indirim ₺0 ama "hiç belge yok" demek yanlış.
    const kart = kdvDonemiKarti(FIRMA, donem({ alisAdet: 3, indirilecekKdv: 0 }))
    expect(kart.gerekce).toContain("3 alış belgesinden")
    expect(kart.gerekce).not.toContain("tek bir alış faturası yok")
  })

  it("indirim hesaplananı aşarsa DEVREDEN KDV denir, 'fark -₺X' denmez", () => {
    const kart = kdvDonemiKarti(FIRMA, donem({ hesaplananKdv: 0, satisAdet: 0, fark: -3_569 }))
    expect(kart.gerekce).toContain("devreden KDV olur")
    expect(kart.gerekce).toContain("Bu dönemde kesilmiş satış faturası yok")
  })

  it("kaçan indirim yoksa başlık sade hatırlatmadır ve kademe düşer", () => {
    const kart = kdvDonemiKarti(FIRMA, donem({ kacanAdet: 0, kacanKdv: 0 }))
    expect(kart.baslik).not.toContain("girmeyecek")
    expect(kart.onem).toBe("orta")
  })

  it("tek fatura toplamı ele geçiriyorsa okuyan UYARILIR (çöp kayıt)", () => {
    const kart = kdvDonemiKarti(FIRMA, donem({ kacanKdv: 240_000, kacanEnBuyuk: 239_000 }))
    expect(kart.gerekce).toContain("TEK faturadan geliyor")
  })
})

// ── K-MUS-06 ────────────────────────────────────────────────────────────────

describe("K-MUS-06 metni", () => {
  const musteri = {
    id: "m1",
    slug: "m-1",
    ad: "KAYIP MÜŞTERİ",
    yetkili: "Ayşe",
    telefon: "0555",
    gun: 100,
    ciro: 50_000,
  }

  it("ritimden türeyen eşikte HESAP yazılır", () => {
    const kart = donmeyenMusteriKarti(FIRMA, {
      adet: 1,
      toplamCiro: 50_000,
      esikGun: 62,
      kaynak: "ritim",
      ritimGun: 31,
      ritimOrnek: 31,
      ornekler: [musteri],
    })
    expect(kart.gerekce).toContain("dörtte üçü 31 gün")
    expect(kart.gerekce).toContain("iki katını")
    expect(kart.karsiTaraf?.telefon).toBe("0555")
  })

  it("kalibrasyon yoksa genel sınır olduğu söylenir", () => {
    const kart = donmeyenMusteriKarti(FIRMA, {
      adet: 1,
      toplamCiro: 50_000,
      esikGun: 90,
      kaynak: "sabit",
      ritimGun: null,
      ritimOrnek: 1,
      ornekler: [musteri],
    })
    expect(kart.gerekce).toContain("ritim ölçmeye yetmediği için")
    expect(kart.gerekce).not.toContain("dörtte üçü")
  })

  it("birden çok müşteride başlık toplulaşır, karşı taraf düşer", () => {
    const kart = donmeyenMusteriKarti(FIRMA, {
      adet: 17,
      toplamCiro: 171_500,
      esikGun: 62,
      kaynak: "ritim",
      ritimGun: 31,
      ritimOrnek: 31,
      ornekler: [musteri],
    })
    expect(kart.baslik).toContain("17 müşteri")
    expect(kart.karsiTaraf).toBeUndefined()
  })
})

// ── K-BLG-09 ────────────────────────────────────────────────────────────────

describe("K-BLG-09 metni", () => {
  const belge = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    slug: "fat-1",
    no: "ADM2026000000012",
    icNo: "SAT-2026-0185",
    musteri: "Müşteri",
    gun: 41,
    tutar: 3_231,
    durum: "REJECTED:HATA",
    belgeNoVar: true,
    ...over,
  })

  it("kart LİSTEDEKİ numarayı yazar, iç numarayı değil", () => {
    const kart = gonderilemeyenKarti(FIRMA, {
      adet: 1,
      toplamTutar: 3_231,
      belgesizAdet: 0,
      enEskiGun: 41,
      ornekler: [belge()],
    })
    expect(kart.baslik).toContain("ADM2026000000012")
    expect(kart.gerekce).not.toContain("SAT-2026-0185")
  })

  it("belge numarası alınamamışsa 'GİB'e ULAŞMADI' denir", () => {
    const kart = gonderilemeyenKarti(FIRMA, {
      adet: 4,
      toplamTutar: 200,
      belgesizAdet: 4,
      enEskiGun: 117,
      ornekler: [belge({ no: "SAT-2026-0006", belgeNoVar: false })],
    })
    expect(kart.gerekce).toContain("ULAŞMADI")
    expect(kart.onem).toBe("kritik")
  })
})

// ── K-MUS-07 ────────────────────────────────────────────────────────────────

describe("K-MUS-07 metni", () => {
  const yogun = (over: Record<string, unknown> = {}) => ({
    musteriId: "m1",
    slug: "m-1",
    ad: "ASDOĞUŞ",
    yetkili: null,
    telefon: null,
    pay: 0.72,
    ciro: 1_000_000,
    toplamCiro: 1_382_434,
    musteriSayisi: 7,
    bakiye: 1_200_000,
    ilkUcPay: 0.99,
    ...over,
  })

  it("açık bakiye varsa RİSK İKİ KATINA çıkar cümlesi eklenir", () => {
    const kart = yogunlasmaKarti(FIRMA, yogun())
    expect(kart.gerekce).toContain("aynı kapıya bağlı")
    expect(kart.onem).toBe("yuksek")
  })

  it("bakiye kapalıysa tahsilat riski taşımadığı söylenir", () => {
    const kart = yogunlasmaKarti(FIRMA, yogun({ pay: 0.48, bakiye: 0 }))
    expect(kart.gerekce).toContain("tahsilat riski taşımıyor")
    expect(kart.onem).toBe("orta")
  })

  it("bakiye ters yöndeyse avans/faturasız iş olduğu söylenir", () => {
    const kart = yogunlasmaKarti(FIRMA, yogun({ bakiye: -50_000 }))
    expect(kart.gerekce).toContain("lehinize dönmüş")
  })

  it("yüzdeler TÜRKÇE EK ALMADAN yazılır (şablondan üretilemez)", () => {
    const kart = yogunlasmaKarti(FIRMA, yogun())
    // "%72'si" / "%72'i" ayrımı sayının okunuşuna bağlı; şablon bunu bilemez.
    expect(kart.baslik).toMatch(/%72 —/)
    expect(kart.baslik).not.toMatch(/%72'[si]/)
  })
})
