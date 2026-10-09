// Para hareketleri → taslak yevmiye fişi (para-kurallari.ts).

import { describe, expect, it } from "vitest"
import {
  bordroFisi,
  cariAcilisFisi,
  ciroFisi,
  finansAcilisFisi,
  hareketFisi,
  kiymetFisi,
  odemeFisi,
  virmanFisi,
  type HareketGirdisi,
} from "./para-kurallari"
import { BOS_ESLESME, type FisSonucu, type HazirFis } from "./fis"

const kasa = { id: "k1", ad: "Merkez Kasa", tur: "CASH" }
const banka = { id: "b1", ad: "Ziraat", tur: "BANK" }

function hazir(f: FisSonucu): HazirFis {
  if (f.durum !== "hazir") throw new Error(`hazır değil: ${f.durum} ${"sebep" in f ? f.sebep : ""}`)
  return f
}
/** "B 100@finans:k1 500" — hesap kodu yoksa alt hesap ya da ?öneri. */
const ozet = (f: FisSonucu) =>
  hazir(f).satirlar.map((s) => {
    const hesap = s.hesapKodu ?? (s.alt ? `${s.oneriKodu}@${s.alt.tur}:${s.alt.id ?? "-"}` : `?${s.oneriKodu}`)
    return `${s.taraf} ${hesap} ${s.tutar}`
  })
const dengeli = (f: FisSonucu) => expect(hazir(f).borcToplami).toBe(hazir(f).alacakToplami)

const hareket = (h: Partial<HareketGirdisi>): HareketGirdisi => ({
  id: "t1",
  tarih: "2026-09-10T11:30:00.000Z",
  tip: "INCOME",
  tutar: 500,
  hesap: kasa,
  ...h,
})

describe("kasa/banka hareketi", () => {
  it("müşteriden tahsilat: B kasa · A müşteri alt hesabı, kasada TAHSİL fişi", () => {
    const f = hareketFisi(hareket({ musteri: { id: "c1", ad: "Ali" } }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 100@finans:k1 500", "A 120@musteri:c1 500"])
    expect(hazir(f).tur).toBe("TAHSIL")
    dengeli(f)
  })

  it("tedarikçiye bankadan ödeme: B tedarikçi · A banka, MAHSUP", () => {
    const f = hareketFisi(hareket({ tip: "EXPENSE", hesap: banka, tedarikci: { id: "s1", ad: "Toptancı" } }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 320@tedarikci:s1 500", "A 102@finans:b1 500"])
    expect(hazir(f).tur).toBe("MAHSUP")
  })

  it("faturasız gider kategoriye göre öğrenilir; öğrenilmemişse 770 tahmindir (emin değil)", () => {
    const yeni = hareketFisi(hareket({ tip: "EXPENSE", kategori: "Kira" }), BOS_ESLESME)
    expect(ozet(yeni)).toEqual(["B 770 500", "A 100@finans:k1 500"])
    expect(hazir(yeni).satirlar[0].anahtarlar).toEqual(["gider:kategori:kira"])
    expect(hazir(yeni).emin).toBe(false)
    const ogrenilmis = hareketFisi(hareket({ tip: "EXPENSE", kategori: "KİRA" }), {
      ogrenilen: { "gider:kategori:kira": "770.01" },
      cariHesaplari: {},
    })
    expect(ozet(ogrenilmis)[0]).toBe("B 770.01 500")
    expect(hazir(ogrenilmis).emin).toBe(true)
  })

  it("faturasız gelir 649", () => {
    expect(ozet(hareketFisi(hareket({ kategori: null }), BOS_ESLESME))).toEqual(["B 100@finans:k1 500", "A 649 500"])
  })

  it("carisiz faturanın tahsilatı ortak perakende alt hesabına (gelir DEĞİL)", () => {
    const f = hareketFisi(hareket({ carisizFaturaOdemesi: { alis: false } }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 100@finans:k1 500", "A 120@musteri:- 500"])
  })

  it("alınan çekin tahsili: B banka · A 101; verilen çekin ödemesi: B 103 · A banka", () => {
    expect(ozet(hareketFisi(hareket({ hesap: banka, kiymet: { tur: "CEK", yon: "RECEIVED", no: "77" } }), BOS_ESLESME))).toEqual([
      "B 102@finans:b1 500",
      "A 101 500",
    ])
    expect(
      ozet(hareketFisi(hareket({ tip: "EXPENSE", hesap: banka, kiymet: { tur: "CEK", yon: "GIVEN", no: "78" } }), BOS_ESLESME)),
    ).toEqual(["B 103 500", "A 102@finans:b1 500"])
    expect(
      ozet(hareketFisi(hareket({ hesap: banka, kiymet: { tur: "SENET", yon: "RECEIVED", no: "S1" } }), BOS_ESLESME))[1],
    ).toBe("A 121 500")
  })

  it("masraf iadesi / maaş ödemesi: B personel alt hesabı · A kasa", () => {
    const f = hareketFisi(hareket({ tip: "EXPENSE", personel: { id: "e1", ad: "Ayşe" } }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 335@personel:e1 500", "A 100@finans:k1 500"])
  })

  it("virman: eşleşmiş kaynak bacak tek fişte B hedef · A kaynak; giriş bacağı fişe girmez", () => {
    const kaynak = hareketFisi(hareket({ tip: "TRANSFER", hesap: kasa, virman: true, virmanHedefi: banka }), BOS_ESLESME)
    expect(ozet(kaynak)).toEqual(["B 102@finans:b1 500", "A 100@finans:k1 500"])
    expect(hazir(kaynak).tur).toBe("MAHSUP")
    expect(hareketFisi(hareket({ hesap: banka, virman: true, virmanGirisBacagi: true }), BOS_ESLESME).durum).toBe("fise-girmez")
  })

  it("virman: karşı bacağı bulunamayan kaynak bacak hesapsız satır taşır; eşleşmemiş giriş referanstaki kasaya", () => {
    const f = hareketFisi(hareket({ tip: "TRANSFER", virman: true }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B ?102 500", "A 100@finans:k1 500"])
    expect(hazir(f).emin).toBe(false)
    const giris = hareketFisi(hareket({ hesap: banka, virman: true, virmanKaynagi: kasa }), BOS_ESLESME)
    expect(ozet(giris)).toEqual(["B 102@finans:b1 500", "A 100@finans:k1 500"])
  })

  it("dövizli hareket kuruyla TL'ye çevrilir; kuru olmayan fişe girmez (kur-yok)", () => {
    expect(hareketFisi(hareket({ paraBirimi: "USD" }), BOS_ESLESME).durum).toBe("kur-yok")
    const f = hareketFisi(hareket({ paraBirimi: "USD", kur: "34.125", tutar: 100 }), BOS_ESLESME)
    expect(ozet(f)[0]).toBe("B 100@finans:k1 3412.5")
    dengeli(f)
    expect(hazir(f).aciklama).toContain("USD ×")
  })

  it("tarih İstanbul günü: 23:30 İstanbul (20:30 UTC) aynı güne düşer", () => {
    const f = hareketFisi(hareket({ tarih: "2026-09-30T20:30:00.000Z" }), BOS_ESLESME)
    expect(hazir(f).tarih.toISOString()).toBe("2026-09-30T00:00:00.000Z")
    const g = hareketFisi(hareket({ tarih: "2026-09-30T21:30:00.000Z" }), BOS_ESLESME)
    expect(hazir(g).tarih.toISOString()).toBe("2026-10-01T00:00:00.000Z")
  })
})

describe("kasasız fatura ödemesi", () => {
  const fatura = (type: string, extra: Record<string, unknown> = {}) => ({
    no: "F1",
    type,
    status: "SENT",
    cari: { id: "c1", ad: "Ali" },
    ...extra,
  })

  it("satışta bakiye kapama: B 611 · A müşteri (verilen iskonto)", () => {
    const f = odemeFisi({ id: "p1", tarih: "2026-09-01", tutar: 12.5, yontem: "WRITE_OFF", fatura: fatura("SALES") }, BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 611 12.5", "A 120@musteri:c1 12.5"])
  })

  it("alışta bakiye kapama: B tedarikçi · A 649 (alınan iskonto)", () => {
    const f = odemeFisi(
      { id: "p1", tarih: "2026-09-01", tutar: 3, yontem: "WRITE_OFF", fatura: fatura("PURCHASE", { cari: { id: "s1", ad: "T" } }) },
      BOS_ESLESME,
    )
    expect(ozet(f)).toEqual(["B 320@tedarikci:s1 3", "A 649 3"])
  })

  it("çalışan cebinden ödedi: B tedarikçi · A personel", () => {
    const f = odemeFisi(
      {
        id: "p1",
        tarih: "2026-09-01",
        tutar: 240,
        yontem: "EMPLOYEE",
        fatura: fatura("PURCHASE", { cari: { id: "s1", ad: "T" } }),
        personel: { id: "e1", ad: "Ayşe" },
      },
      BOS_ESLESME,
    )
    expect(ozet(f)).toEqual(["B 320@tedarikci:s1 240", "A 335@personel:e1 240"])
  })

  it("eski kayıt (kasa verilmiş, hareketsiz) ve kasası yazılmamış ödeme", () => {
    expect(
      ozet(odemeFisi({ id: "p", tarih: "2026-09-01", tutar: 100, yontem: "CASH", fatura: fatura("SALES"), hesap: kasa }, BOS_ESLESME)),
    ).toEqual(["B 100@finans:k1 100", "A 120@musteri:c1 100"])
    const f = odemeFisi({ id: "p", tarih: "2026-09-01", tutar: 100, yontem: "CASH", fatura: fatura("SALES") }, BOS_ESLESME)
    expect(ozet(f)).toEqual(["B ?100 100", "A 120@musteri:c1 100"])
    expect(hazir(f).emin).toBe(false)
  })

  it("satış iadesinin ödemesi müşteriye para iadesidir: B müşteri", () => {
    const f = odemeFisi({ id: "p", tarih: "2026-09-01", tutar: 50, yontem: "CASH", fatura: fatura("RETURN"), hesap: kasa }, BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 120@musteri:c1 50", "A 100@finans:k1 50"])
  })

  it("iptal faturanın ödemesi fişe girmez; dövizli fatura ödemesi faturanın kuruyla", () => {
    expect(odemeFisi({ id: "p", tarih: "2026-09-01", tutar: 1, yontem: "WRITE_OFF", fatura: fatura("SALES", { status: "CANCELLED" }) }, BOS_ESLESME).durum).toBe(
      "fise-girmez",
    )
    const f = odemeFisi(
      { id: "p", tarih: "2026-09-01", tutar: 10, yontem: "WRITE_OFF", fatura: fatura("SALES", { paraBirimi: "USD", kur: 41.5 }) },
      BOS_ESLESME,
    )
    expect(hazir(f).borcToplami).toBe(415)
  })
})

describe("çek / senet", () => {
  const cek = { id: "ch1", tur: "CEK" as const, no: "123", tarih: "2026-09-05", tutar: 1000, durum: "PORTFÖYDE", banka: "Akbank" }

  it("alınan çek: B 101 · A müşteri", () => {
    expect(ozet(kiymetFisi({ ...cek, yon: "RECEIVED", musteri: { id: "c1", ad: "Ali" } }))).toEqual(["B 101 1000", "A 120@musteri:c1 1000"])
  })

  it("verilen çek: B tedarikçi · A 103; senette 121/321", () => {
    expect(ozet(kiymetFisi({ ...cek, yon: "GIVEN", tedarikci: { id: "s1", ad: "T" } }))).toEqual(["B 320@tedarikci:s1 1000", "A 103 1000"])
    expect(ozet(kiymetFisi({ ...cek, tur: "SENET", yon: "GIVEN", tedarikci: { id: "s1", ad: "T" } }))[1]).toBe("A 321 1000")
  })

  it("iade / protestolu evrak cari bakiyesine girmez → fişe de girmez", () => {
    expect(kiymetFisi({ ...cek, yon: "RECEIVED", durum: "İADE_EDİLDİ", musteri: { id: "c1", ad: "A" } }).durum).toBe("fise-girmez")
    expect(kiymetFisi({ ...cek, yon: "RECEIVED", durum: "PROTESTOLU", musteri: { id: "c1", ad: "A" } }).durum).toBe("fise-girmez")
  })

  it("tahsil edilmiş alınan çekin alış fişi yine durur (tahsil ayrı hareket)", () => {
    expect(kiymetFisi({ ...cek, yon: "RECEIVED", durum: "TAHSİL_EDİLDİ", musteri: { id: "c1", ad: "A" } }).durum).toBe("hazir")
  })

  it("ciro: B tedarikçi (seçilir) · A 101; yalnız ciro edilmiş ALINAN evrak", () => {
    const f = ciroFisi({ ...cek, yon: "RECEIVED", durum: "CİRO_EDİLDİ", ciroTarihi: "2026-09-20T10:00:00Z" })
    expect(ozet(f)).toEqual(["B ?320 1000", "A 101 1000"])
    expect(hazir(f).emin).toBe(false)
    expect(ciroFisi({ ...cek, yon: "RECEIVED", ciroTarihi: "2026-09-20" }).durum).toBe("fise-girmez")
  })
})

describe("cari virman, bordro, açılış bakiyeleri", () => {
  it("iki bacaklı virman: B borç bacağı · A alacak bacağı", () => {
    const f = virmanFisi({
      id: "v1",
      no: "VRM-000001",
      tarih: "2026-09-12",
      tutar: 300,
      bacaklar: [
        { taraf: "DEBIT", tedarikci: { id: "s1", ad: "T" } },
        { taraf: "CREDIT", musteri: { id: "c1", ad: "A" } },
      ],
    })
    expect(ozet(f)).toEqual(["B 320@tedarikci:s1 300", "A 120@musteri:c1 300"])
  })

  it("tek taraflı virmanın karşılığı hesapsız (öneri 649/659)", () => {
    const f = virmanFisi({ id: "v1", no: "V", tarih: "2026-09-12", tutar: 300, bacaklar: [{ taraf: "DEBIT", musteri: { id: "c1", ad: "A" } }] })
    expect(ozet(f)).toEqual(["B 120@musteri:c1 300", "A ?649 300"])
  })

  it("bordro tahakkuku dengeli: brüt = SGK + vergi + diğer + avans + net, dönem sonu tarihli", () => {
    const f = bordroFisi(
      {
        id: "pr1",
        yil: 2026,
        ay: 2,
        personel: { id: "e1", ad: "Ayşe" },
        brut: 30000,
        prim: 2000,
        avans: 5000,
        sgk: 4480,
        vergi: 3200,
        diger: 300,
        net: 19020,
      },
      BOS_ESLESME,
    )
    expect(ozet(f)).toEqual(["B 770 32000", "A 361 4480", "A 360 3200", "A 369 300", "A 196 5000", "A 335@personel:e1 19020"])
    expect(hazir(f).tarih.toISOString().slice(0, 10)).toBe("2026-02-28")
    dengeli(f)
  })

  it("işveren SGK payı ayrı satır çifti (B gider · A 361), netten düşmez; hesaplandıysa açıklama söyler", () => {
    const girdi = {
      id: "pr1",
      yil: 2026,
      ay: 2,
      personel: { id: "e1", ad: "Ayşe" },
      brut: 30000,
      prim: 2000,
      avans: 0,
      sgk: 4800,
      vergi: 3200,
      diger: 0,
      net: 24000,
      isverenSgk: 7600,
    }
    const f = bordroFisi({ ...girdi, isverenSgkHesaplandi: true }, BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 770 32000", "B 770 7600", "A 361 4800", "A 361 7600", "A 360 3200", "A 335@personel:e1 24000"])
    dengeli(f)
    const isveren = hazir(f).satirlar.filter((s) => s.aciklama.startsWith("SGK işveren payı"))
    expect(isveren.every((s) => s.aciklama.includes("teşviksiz oranla hesaplandı"))).toBe(true)
    // Gider satırı ayrı anahtarla öğrenilir (brüt ücretten farklı alt hesap seçilebilsin).
    expect(isveren.find((s) => s.taraf === "B")?.anahtarlar).toEqual(["bordro:isveren-sgk"])
    // Girilmiş tutarda açıklama notu yok; tutar 0 ise satır hiç doğmaz.
    expect(hazir(bordroFisi(girdi, BOS_ESLESME)).satirlar.some((s) => s.aciklama.includes("hesaplandı"))).toBe(false)
    expect(ozet(bordroFisi({ ...girdi, isverenSgk: 0 }, BOS_ESLESME))).not.toContain("B 770 7600")
  })

  it("cari kartın açılış bakiyesi: karşılığı bir kez seçilir, sonra öğrenilir", () => {
    const yeni = cariAcilisFisi({ id: "c1", tur: "musteri", ad: "Ali", tarih: "2026-03-01", tutar: 900, tip: "DEBIT" }, BOS_ESLESME)
    expect(ozet(yeni)).toEqual(["B 120@musteri:c1 900", "A ?500 900"])
    expect(hazir(yeni).tur).toBe("ACILIS")
    const ogrenilmis = cariAcilisFisi(
      { id: "s1", tur: "tedarikci", ad: "T", tarih: "2026-03-01", tutar: 400, tip: "CREDIT" },
      { ogrenilen: { "acilis:cari": "500.01" }, cariHesaplari: {} },
    )
    expect(ozet(ogrenilmis)).toEqual(["B 500.01 400", "A 320@tedarikci:s1 400"])
  })

  it("kasa hesabının açılış bakiyesi", () => {
    expect(ozet(finansAcilisFisi({ hesap: banka, tarih: "2026-03-01", tutar: 1500 }, BOS_ESLESME))).toEqual([
      "B 102@finans:b1 1500",
      "A ?500 1500",
    ])
  })
})

describe("türlü hareket (vergi, SGK, avans, kredi, ortak)", () => {
  it("SGK ödemesi gider değil: B 361 · A banka, emin", () => {
    const f = hareketFisi(hareket({ tip: "EXPENSE", hesap: banka, tur: "SGK", kategori: "SGK" }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 361 500", "A 102@finans:b1 500"])
    expect(hazir(f).emin).toBe(true)
    expect(hazir(f).aciklama).toContain("SGK prim ödemesi")
  })

  it("vergi ödemesi 360'a, öğrenme anahtarı kategoriyle (muhtasar → 360.02)", () => {
    const f = hareketFisi(hareket({ tip: "EXPENSE", hesap: banka, tur: "TAX", kategori: "Muhtasar" }), {
      ...BOS_ESLESME,
      ogrenilen: { "odeme:vergi:muhtasar": "360.02" },
    })
    expect(ozet(f)).toEqual(["B 360.02 500", "A 102@finans:b1 500"])
    expect(hazir(f).satirlar[0].anahtarlar).toEqual(["odeme:vergi:muhtasar"])
  })

  it("KDV ödemesi 360", () => {
    expect(ozet(hareketFisi(hareket({ tip: "EXPENSE", tur: "KDV" }), BOS_ESLESME))).toEqual(["B 360 500", "A 100@finans:k1 500"])
  })

  it("personel avansı 196, açıklamada çalışan", () => {
    const f = hareketFisi(hareket({ tip: "EXPENSE", tur: "ADVANCE", avansPersonel: { id: "e1", ad: "Ayşe Kaya" } }), BOS_ESLESME)
    expect(ozet(f)).toEqual(["B 196 500", "A 100@finans:k1 500"])
    expect(hazir(f).satirlar[0].aciklama).toBe("Personel avansı verildi · Ayşe Kaya")
    expect(hazir(f).emin).toBe(true)
  })

  it("kredi kullanımı A 300, ödemesi B 300 — vade müşavirce seçilir (emin değil)", () => {
    const giris = hareketFisi(hareket({ tip: "INCOME", hesap: banka, tur: "LOAN" }), BOS_ESLESME)
    expect(ozet(giris)).toEqual(["B 102@finans:b1 500", "A 300 500"])
    expect(hazir(giris).emin).toBe(false)
    const cikis = hareketFisi(hareket({ tip: "EXPENSE", hesap: banka, tur: "LOAN" }), BOS_ESLESME)
    expect(ozet(cikis)).toEqual(["B 300 500", "A 102@finans:b1 500"])
  })

  it("ortaktan gelen 331, ortağa ödenen 131", () => {
    expect(ozet(hareketFisi(hareket({ tip: "INCOME", tur: "PARTNER" }), BOS_ESLESME))).toEqual(["B 100@finans:k1 500", "A 331 500"])
    expect(ozet(hareketFisi(hareket({ tip: "EXPENSE", tur: "PARTNER" }), BOS_ESLESME))).toEqual(["B 131 500", "A 100@finans:k1 500"])
  })
})
