// Açılış bakiyesi süzgecinin İŞARET yönü.
//
// `ters-bakiye.ts`teki diğer bütün süzgeçler canlı veride koştu ve sonuçları
// katalogda yazılı. Bu biri koşmadı: 349 müşteri, 56 tedarikçinin tamamının
// açılış tipi DEBIT. Yön yanlış yazılsaydı ölçümde hiçbir şey değişmez, hata
// ancak ilk CREDIT açılışı giren kullanıcıda görünürdü — ve orada da sessiz
// olurdu: kart ya haksız çıkar ya hiç çıkmaz.
//
// Yön kuralı (bkz. lib/cari/list-query.ts bakiye formülü):
//   müşteri  → CREDIT açılış bakiyeyi EKSİYE çeker  (ters yön)
//   tedarikçi→ DEBIT  açılış bakiyeyi EKSİYE çeker  (ters yön)

import { describe, expect, it } from "vitest"
import { acilisAcikliyor } from "./ters-bakiye"

const cari = (tutar: number, tip: string) => ({
  openingBalanceAmount: tutar,
  openingBalanceType: tip,
})

describe("açılış bakiyesi süzgeci", () => {
  it("müşteride ters yön CREDIT'tir", () => {
    expect(acilisAcikliyor(cari(5000, "CREDIT"), "musteri", 4000)).toBe(true)
    expect(acilisAcikliyor(cari(5000, "DEBIT"), "musteri", 4000)).toBe(false)
  })

  it("tedarikçide ters yön DEBIT'tir — müşterinin AYNISI DEĞİL", () => {
    expect(acilisAcikliyor(cari(5000, "DEBIT"), "tedarikci", 4000)).toBe(true)
    expect(acilisAcikliyor(cari(5000, "CREDIT"), "tedarikci", 4000)).toBe(false)
  })

  it("açılış ters bakiyeyi KARŞILAMIYORSA kart çıkar", () => {
    // ₺5.000 devreden alacak, ₺9.000 ters bakiye: aradaki ₺4.000 hâlâ açıklamasız.
    expect(acilisAcikliyor(cari(5000, "CREDIT"), "musteri", 9000)).toBe(false)
    // Tam sınırda: açılış tutarı kadar ters bakiye tamamen açıklanmıştır.
    expect(acilisAcikliyor(cari(5000, "CREDIT"), "musteri", 5000)).toBe(true)
  })

  it("açılış girilmemişse süzgeç hiç çalışmaz", () => {
    expect(acilisAcikliyor(cari(0, "CREDIT"), "musteri", 4000)).toBe(false)
    expect(acilisAcikliyor({}, "musteri", 4000)).toBe(false)
  })
})

// ── SÜZGEÇLER ───────────────────────────────────────────────────────────────
//
// Dört yanlış-pozitif sınıfı da canlı ÖLÇÜMLE bulundu ve elendi. Ölçüm bir
// kerelikti: süzgeçlerden biri kaldırılırsa hiçbir sorgu hata vermez, kart
// sessizce yanlış cariyi göstermeye başlar. Bu yüzden karar mantığı saf
// fonksiyona ayrıldı (`tersBakiyeSec`) ve dört sınıfın dördü de burada duruyor.

import { tersBakiyeSec, TABAN, type FaturaSayisi } from "./ters-bakiye"

const aday = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Test Cari",
  slug: "test-cari",
  contactPerson: "Yetkili",
  phone: "0555",
  balance: -50_000,
  openingBalanceAmount: 0,
  openingBalanceType: "DEBIT",
  isAlsoSupplier: false,
  isAlsoCustomer: false,
  ...over,
})

const fatura = (over: Partial<FaturaSayisi> = {}): FaturaSayisi => ({
  id: "c1",
  dogal_adet: 2,
  dogal_tutar: 30_000,
  ters_adet: 0,
  doviz_adet: 0,
  ...over,
})

const harita = (...f: FaturaSayisi[]) => new Map(f.map((x) => [x.id, x]))

describe("ters bakiye süzgeçleri", () => {
  it("mahsuplu cari ELENİR — ters yönde faturası varsa bakiye netleşmeden doğar", () => {
    // earsin sinar vakası: −₺78.365 ters bakiye, sebebi ₺194.427'lik açık alış.
    const sonuc = tersBakiyeSec([aday()], harita(fatura({ ters_adet: 7 })), "musteri")
    expect(sonuc).toBeNull()
  })

  it("döviz faturası olan cari ELENİR — bakiye kur çevirmeden toplanıyor", () => {
    expect(tersBakiyeSec([aday()], harita(fatura({ doviz_adet: 1 })), "musteri")).toBeNull()
  })

  it("taban altındaki fark ELENİR — ₺2'lik yuvarlama artığı kart değildir", () => {
    expect(tersBakiyeSec([aday({ balance: -2 })], harita(fatura()), "musteri")).toBeNull()
    // Tam sınırda da geçmez; sınırın üstü geçer.
    expect(tersBakiyeSec([aday({ balance: -TABAN })], harita(fatura()), "musteri")).toBeNull()
    expect(tersBakiyeSec([aday({ balance: -TABAN - 1 })], harita(fatura()), "musteri")).not.toBeNull()
  })

  it("açılış bakiyesinin açıkladığı ters bakiye ELENİR, açıklamadığı KALIR", () => {
    const acilisli = (tutar: number) =>
      aday({ balance: -40_000, openingBalanceAmount: tutar, openingBalanceType: "CREDIT" })
    // ₺40.000 devreden alacak girilmişse ters bakiye kaydın kendisidir.
    expect(tersBakiyeSec([acilisli(40_000)], harita(fatura()), "musteri")).toBeNull()
    // ₺10.000 açılış, ₺40.000 ters bakiyeyi açıklamaz.
    expect(tersBakiyeSec([acilisli(10_000)], harita(fatura()), "musteri")).not.toBeNull()
  })

  it("faturası HİÇ olmayan cari kalır ve ayrıca sayılır — kartın en güçlü hâli", () => {
    const sonuc = tersBakiyeSec([aday()], harita(), "musteri")
    expect(sonuc?.faturasizAdet).toBe(1)
    expect(sonuc?.ornekler[0].faturaAdet).toBe(0)
  })

  it("en büyük tutar öne geçer ve TOPLAM ALINMAZ (çöp kayıt tek satırda kalsın)", () => {
    const sonuc = tersBakiyeSec(
      [
        aday({ id: "a", name: "Küçük", balance: -1_000 }),
        aday({ id: "b", name: "Büyük", balance: -900_000 }),
      ],
      harita(fatura({ id: "a" }), fatura({ id: "b" })),
      "tedarikci"
    )
    expect(sonuc?.ornekler.map((c) => c.ad)).toEqual(["Büyük", "Küçük"])
    expect(sonuc?.enBuyuk).toBe(900_000)
    expect(sonuc).not.toHaveProperty("toplam")
  })

  it("çift rol ve açılış bayrakları YALNIZ kartta görünen carilerden hesaplanır", () => {
    const sonuc = tersBakiyeSec(
      [
        aday({ id: "a", balance: -5_000 }),
        aday({ id: "b", balance: -4_000 }),
        aday({ id: "c", balance: -3_000 }),
        // Dördüncü cari kartta görünmüyor; bayrağı da tetiklememeli.
        aday({ id: "d", balance: -1_000, isAlsoSupplier: true }),
      ],
      harita(...["a", "b", "c", "d"].map((id) => fatura({ id }))),
      "musteri"
    )
    expect(sonuc?.adet).toBe(4)
    expect(sonuc?.ornekler).toHaveLength(3)
    expect(sonuc?.ciftRolVar).toBe(false)
  })
})
