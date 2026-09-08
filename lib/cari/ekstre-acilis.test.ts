// EKSTRENİN AÇILIŞ SATIRI — iki ekran arasındaki farkın kapatıldığı yer.
//
// Cari listesi ve yaşlandırma açılış bakiyesini hesaba katıyordu, ekstre için
// satır üretmiyordu: ABC Müşteri A.Ş. cari listesinde −47.214 TL, ekstrede
// −62.214 TL görünüyordu (aradaki 15.000 TL kartına girilmiş açılış).
//
// Yön eşlemesi CANLI VERİDE SINANAMIYOR: 349 müşteri ve 56 tedarikçinin
// tamamı DEBIT açılışla duruyor, CREDIT dalı bir kez bile koşmadı. İşaret ters
// yazılsaydı bakiye açılış tutarının İKİ KATI kadar sapardı ve bunu ancak
// açılışı olan ilk müşteri fark ederdi.

import { describe, expect, it } from "vitest"
import { acilisSatiri, type AcilisKaydi } from "./ekstre-query"

const KAYIT: AcilisKaydi = {
  id: "c1",
  name: "ABC Müşteri A.Ş.",
  createdAt: new Date("2026-01-15T00:00:00.000Z"),
  openingBalanceAmount: 15_000,
  openingBalanceType: "DEBIT",
}

const kayit = (over: Partial<AcilisKaydi> = {}): AcilisKaydi => ({ ...KAYIT, ...over })

describe("ekstre açılış satırı", () => {
  it("DEBIT açılış BORÇ sütununa yazılır", () => {
    const satir = acilisSatiri(kayit())
    expect(satir?.debit).toBe(15_000)
    expect(satir?.credit).toBe(0)
    expect(satir?.type).toBe("OPENING")
    expect(satir?.description).toBe("Açılış bakiyesi")
  })

  it("CREDIT açılış ALACAK sütununa yazılır — canlı veride hiç koşmayan dal", () => {
    const satir = acilisSatiri(kayit({ openingBalanceType: "CREDIT" }))
    expect(satir?.credit).toBe(15_000)
    expect(satir?.debit).toBe(0)
  })

  it("tip boş/bilinmezse DEBIT sayılır (bakiye formülünün varsayımıyla aynı)", () => {
    expect(acilisSatiri(kayit({ openingBalanceType: null }))?.debit).toBe(15_000)
    expect(acilisSatiri(kayit({ openingBalanceType: "debit" }))?.debit).toBe(15_000)
  })

  it("açılış girilmemişse SATIR ÜRETİLMEZ — sıfır satırı ekstreyi kirletir", () => {
    expect(acilisSatiri(kayit({ openingBalanceAmount: 0 }))).toBeNull()
    expect(acilisSatiri(kayit({ openingBalanceAmount: null }))).toBeNull()
    expect(acilisSatiri(kayit({ openingBalanceAmount: "abc" }))).toBeNull()
    expect(acilisSatiri(null)).toBeNull()
  })

  it("Decimal/string tutar sayıya çevrilir", () => {
    expect(acilisSatiri(kayit({ openingBalanceAmount: "15000.00" }))?.debit).toBe(15_000)
  })

  it("tarih hesabın açıldığı gündür — yaşlandırma raporuyla aynı kaynak", () => {
    expect(acilisSatiri(kayit())?.date.toISOString()).toBe("2026-01-15T00:00:00.000Z")
  })

  it("dönem süzgeci açılışı da kapsar: aralık dışındaysa satır çıkmaz", () => {
    // Hesap Ocak'ta açılmış; kullanıcı Ağustos'u seçtiyse açılış o dönemde yok.
    expect(acilisSatiri(kayit(), "2026-08-01", "2026-08-31")).toBeNull()
    // Aralık açılışı kapsıyorsa satır gelir.
    expect(acilisSatiri(kayit(), "2026-01-01", "2026-01-31")?.debit).toBe(15_000)
    // Tek uçlu süzgeçler de çalışır.
    expect(acilisSatiri(kayit(), "2026-02-01", null)).toBeNull()
    expect(acilisSatiri(kayit(), null, "2026-02-01")?.debit).toBe(15_000)
  })
})

// ── ÇEK/SENET YÖNÜ ──────────────────────────────────────────────────────────
//
// Aynı denetimde ikinci ve daha büyük bir sapma çıktı: ekstre kıymetin
// `direction` alanına bakmıyor, hangi cari alanının dolu olduğuna bakıyordu.
// Müşteriden ALINAN çek onun borcunu kapatır; ekstre borcu ARTIRIYORDU. Üç
// caride fark, çek tutarının tam iki katıydı (ters işaretin imzası).
//
// Dört kombinasyonun ikisi canlı veride hiç yok (müşteriye VERİLEN çek,
// tedarikçiden ALINAN çek) — ölçüm onları göremez, test görür.

import { kiymetYonu } from "./ekstre-query"

describe("çek/senedin ekstredeki yönü", () => {
  it("müşteriden ALINAN çek ALACAK yazılır — borcunu kapatır", () => {
    expect(kiymetYonu({ customerId: "c1", direction: "RECEIVED", amount: 100_000 })).toEqual({
      debit: 0,
      credit: 100_000,
    })
  })

  it("müşteriye VERİLEN çek BORÇ yazılır — alacağı artırır (canlı veride yok)", () => {
    expect(kiymetYonu({ customerId: "c1", direction: "GIVEN", amount: 100_000 })).toEqual({
      debit: 100_000,
      credit: 0,
    })
  })

  it("tedarikçiye VERİLEN çek BORÇ yazılır — ekstrenin ekseni ters olduğu için", () => {
    expect(kiymetYonu({ customerId: null, direction: "GIVEN", amount: 50_000 })).toEqual({
      debit: 50_000,
      credit: 0,
    })
  })

  it("tedarikçiden ALINAN çek ALACAK yazılır (canlı veride yok)", () => {
    expect(kiymetYonu({ customerId: null, direction: "RECEIVED", amount: 50_000 })).toEqual({
      debit: 0,
      credit: 50_000,
    })
  })

  it("yön BOŞSA eski davranış: müşteride alınan, tedarikçide verilen sayılır", () => {
    expect(kiymetYonu({ customerId: "c1", direction: null, amount: 10 }).credit).toBe(10)
    expect(kiymetYonu({ customerId: null, direction: null, amount: 10 }).debit).toBe(10)
  })
})
