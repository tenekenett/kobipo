// K-BLG-09'un NUMARA KURALI — tarayıcı denetiminde bulunan hatanın nöbetçisi.
//
// Kart "SAT-2026-0185" diyordu, liste aynı belgeyi "ADM2026000000012" diye
// gösteriyordu: fatura listesi `eDocumentNo || invoiceNo` basıyor
// (`lib/faturalar/list-query.ts`). Kullanıcı kartın işaret ettiği satırı
// bulamıyordu ve hiçbir test bunu görmüyordu.

import { describe, expect, it } from "vitest"
import { gonderilemeyenSec, durumOzeti, type HamBelge } from "./gonderilemeyen-fatura"

const BUGUN = new Date("2026-09-07T09:00:00Z")
const gunOnce = (n: number) => new Date(BUGUN.getTime() - n * 86_400_000)

const belge = (over: Partial<HamBelge> & { id: string; yas: number }): HamBelge => ({
  slug: null,
  invoiceNo: `SAT-${over.id}`,
  date: gunOnce(over.yas),
  totalAmount: 1_000,
  currency: "TRY",
  integrationStatus: "ERROR:Bozuk UUID kaydedilmiş",
  eDocumentNo: null,
  customer: { name: "Müşteri" },
  ...over,
})

describe("K-BLG-09 belge numarası ve özet", () => {
  it("resmî belge numarası VARSA kart onu yazar — liste de onu gösteriyor", () => {
    const o = gonderilemeyenSec([belge({ id: "a", yas: 40, eDocumentNo: "ADM2026000000012" })], BUGUN)
    expect(o?.ornekler[0].no).toBe("ADM2026000000012")
    // İç numara kaybolmaz: günlükte iz sürmek için taşınır.
    expect(o?.ornekler[0].icNo).toBe("SAT-a")
    expect(o?.belgesizAdet).toBe(0)
  })

  it("resmî numara YOKSA iç numaraya düşer ve BELGESİZ sayılır", () => {
    const o = gonderilemeyenSec([belge({ id: "b", yas: 117 })], BUGUN)
    expect(o?.ornekler[0].no).toBe("SAT-b")
    // Belge numarası hiç alınamamışsa belge GİB'e ulaşmamıştır — kart bunu ayrıca söyler.
    expect(o?.belgesizAdet).toBe(1)
  })

  it("en eski belge yaşı korunur — aksiyon linkinin penceresi bundan türüyor", () => {
    const o = gonderilemeyenSec(
      [belge({ id: "yeni", yas: 5 }), belge({ id: "eski", yas: 117 })],
      BUGUN
    )
    expect(o?.enEskiGun).toBe(117)
  })

  it("tutar yalnız TRY'den toplanır", () => {
    const o = gonderilemeyenSec(
      [
        belge({ id: "tl", yas: 10, totalAmount: 3_000 }),
        belge({ id: "usd", yas: 10, totalAmount: 500, currency: "USD" }),
      ],
      BUGUN
    )
    expect(o?.adet).toBe(2)
    expect(o?.toplamTutar).toBe(3_000)
  })

  it("uzun entegratör hatası kartta kısaltılır, günlükte tam kalır", () => {
    const uzun = "ERROR:Şematron hata: " + "x".repeat(400)
    const o = gonderilemeyenSec([belge({ id: "a", yas: 3, integrationStatus: uzun })], BUGUN)
    // Özet kısalır…
    expect(durumOzeti(uzun).length).toBeLessThan(80)
    expect(durumOzeti(uzun).endsWith("…")).toBe(true)
    // …ama ham durum kaydın içinde tam duruyor (olcum'a o gidiyor).
    expect(o?.ornekler[0].durum).toBe(uzun)
  })

  it("satır yoksa kart hiç üretilmez", () => {
    expect(gonderilemeyenSec([], BUGUN)).toBeNull()
  })
})
