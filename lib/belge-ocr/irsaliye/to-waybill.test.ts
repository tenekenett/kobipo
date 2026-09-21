/**
 * Okunan irsaliye → `/api/irsaliye` gövdesi. Kritik ayrım: ürünle EŞLEŞMEYEN
 * satır kaydı engellemez (uyarı) ama "Teslim alındı"da stoğa girmez; miktarsız
 * satır ise hiç yazılmaz — irsaliyede miktar belgenin kendisidir.
 */

import { describe, expect, it } from "vitest"
import type { Irsaliye, IrsaliyeKalem } from "./schema"
import { irsaliyeToWaybillBody } from "./to-waybill"

const BIZ = "7352344835"
const TEDARIKCI = "3531285187"
const BUGUN = new Date("2026-09-21T10:00:00Z")
const SECENEK = { companyId: "c1", yon: "ALIS" as const, supplierId: "s1", bugun: BUGUN }

const kalem = (p: Partial<IrsaliyeKalem> = {}): IrsaliyeKalem => ({ ad: "Ürün A", saticiKodu: null, miktar: 5, birim: "adet", ...p })

function irsaliye(p: Partial<Irsaliye> = {}): Irsaliye {
  return {
    saticiUnvan: "EREN FORKLİFT", saticiVknTckn: TEDARIKCI, aliciUnvan: "REYPO", aliciVknTckn: BIZ,
    irsaliyeNo: "IRS2026000001", ettn: null, duzenlemeTarihi: "2026-09-01", sevkTarihi: "2026-09-02",
    tasiyici: null, plaka: null, sofor: null, sevkAdresi: null, faturaNoAtfi: null,
    kalemler: [kalem()], guven: { satici: 0.9, alici: 0.9, tarih: 0.9, kalemler: 0.9 },
    ...p,
  }
}

const uyari = <T extends { anahtar: string }>(u: T[], a: string) => u.find((x) => x.anahtar === a)

describe("irsaliyeToWaybillBody", () => {
  it("ALIS → PURCHASE + supplierId, SATIS → SALES + customerId", () => {
    const alis = irsaliyeToWaybillBody(irsaliye(), SECENEK).body
    expect(alis.type).toBe("PURCHASE")
    expect(alis.supplierId).toBe("s1")
    expect(alis.waybillNo).toBe("IRS2026000001")
    expect(alis.date).toBe("2026-09-01")
    expect(alis.deliveryDate).toBe("2026-09-02")

    const satis = irsaliyeToWaybillBody(irsaliye(), { companyId: "c1", yon: "SATIS", customerId: "m1", bugun: BUGUN }).body
    expect(satis.type).toBe("SALES")
    expect(satis.customerId).toBe("m1")
  })

  it("miktarsız satır irsaliyeye ALINMAZ ve ağır uyarı verir", () => {
    const { body, uyarilar } = irsaliyeToWaybillBody(irsaliye({ kalemler: [kalem(), kalem({ ad: "Ürün B", miktar: null }), kalem({ ad: "Ürün C", miktar: 0 })] }), {
      ...SECENEK,
      urunEslesme: new Map([[0, "p1"]]),
    })
    expect(body.items).toHaveLength(1)
    expect(uyari(uyarilar, "kalem")?.agir).toBe(true)
  })

  it("ürünle eşleşmeyen satır kaydı KİLİTLEMEZ, yalnız uyarır", () => {
    const { body, uyarilar } = irsaliyeToWaybillBody(irsaliye({ kalemler: [kalem(), kalem({ ad: "Ürün B" })] }), { ...SECENEK, urunEslesme: new Map([[0, "p1"]]) })
    expect(body.items[0].productId).toBe("p1")
    expect(body.items[1]).not.toHaveProperty("productId")
    const u = uyari(uyarilar, "urun")
    expect(u?.agir).toBeUndefined()
    expect(u?.mesaj).toContain("1 satır")
  })

  it("cari seçilmeden kayıt olmaz — uç 400 döner, kart kilitler", () => {
    expect(uyari(irsaliyeToWaybillBody(irsaliye(), { companyId: "c1", yon: "ALIS", bugun: BUGUN }).uyarilar, "cari")?.agir).toBe(true)
    expect(uyari(irsaliyeToWaybillBody(irsaliye(), { companyId: "c1", yon: "SATIS", bugun: BUGUN }).uyarilar, "cari")?.mesaj).toContain("Müşteri")
  })

  it("numara okunamadıysa ağır uyarı verir", () => {
    expect(uyari(irsaliyeToWaybillBody(irsaliye({ irsaliyeNo: null }), SECENEK).uyarilar, "no")?.agir).toBe(true)
  })

  it("birim büyük harfe çevrilir, sevk bilgileri ve not taşınır", () => {
    const { body } = irsaliyeToWaybillBody(
      irsaliye({ tasiyici: "Aras", plaka: "20 ABC 123", sofor: "Ali", sevkAdresi: "Merkez Mah.", ettn: "e-1", faturaNoAtfi: "FTR1" }),
      { ...SECENEK, kaynak: "kâğıt irsaliye" }
    )
    expect(body.items[0].unit).toBe("ADET")
    expect(body.items[0].quantity).toBe(5)
    expect(body).toMatchObject({ carrier: "Aras", vehicleNo: "20 ABC 123", driverName: "Ali", deliveryAddress: "Merkez Mah." })
    expect(body.notes).toContain("ETTN: e-1")
    expect(body.notes).toContain("Fatura No: FTR1")
    expect(body.notes).toContain("kâğıt irsaliye")
  })

  it("geçersiz tarihte bugüne düşer, sevk tarihi yoksa alan hiç yazılmaz", () => {
    const { body } = irsaliyeToWaybillBody(irsaliye({ duzenlemeTarihi: "01/09/2026", sevkTarihi: null }), SECENEK)
    expect(body.date).toBe("2026-09-21")
    expect(body).not.toHaveProperty("deliveryDate")
  })
})
