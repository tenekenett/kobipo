import { describe, expect, it } from "vitest"
import { kiymetleriKalemeCevir } from "./nakit-kiymet"
import { buildCashProjection } from "./nakit-projeksiyon-kova"

const BUGUN = new Date(2026, 8, 7) // 7 Eylül 2026, Pazartesi

const cek = (over: Partial<Parameters<typeof kiymetleriKalemeCevir>[0][number]> = {}) => ({
  amount: 100000,
  dueDate: new Date(2026, 8, 20),
  direction: "RECEIVED" as string | null,
  supplierId: null as string | null,
  ...over,
})

describe("çek/senet → nakit projeksiyonu kalemi", () => {
  it("alınan evrak giriş, verilen evrak çıkış olur", () => {
    const kalemler = kiymetleriKalemeCevir(
      [cek({ direction: "RECEIVED" }), cek({ direction: "GIVEN", amount: 40000 })],
      BUGUN
    )
    expect(kalemler.map((k) => [k.direction, k.amount])).toEqual([
      ["in", 100000],
      ["out", 40000],
    ])
  })

  /**
   * `direction` sonradan eklendi; eski kayıtlarda null. Kural tek kaynaktan
   * (`resolveCekSenetDirection`) gelmeli — portföy ekranı "alınan" derken rapor
   * "verilen" sayarsa aynı çek bir yerde giriş, bir yerde çıkış olur.
   */
  it("eski kayıtta yön tedarikçi bağından çözülür", () => {
    const kalemler = kiymetleriKalemeCevir(
      [
        cek({ direction: null, supplierId: "ted-1" }),
        cek({ direction: null, supplierId: null }),
      ],
      BUGUN
    )
    expect(kalemler.map((k) => k.direction)).toEqual(["out", "in"])
  })

  it("vadesi bugün olan girer, dünkü girmez", () => {
    const kalemler = kiymetleriKalemeCevir(
      [
        cek({ dueDate: new Date(2026, 8, 7), amount: 11 }),
        cek({ dueDate: new Date(2026, 8, 6), amount: 22 }),
      ],
      BUGUN
    )
    expect(kalemler.map((k) => k.amount)).toEqual([11])
  })

  /**
   * Vade günün İÇİNDE bir saatte kayıtlıysa (00:00 değil) gün karşılaştırması
   * yine bugüne düşmeli; ham `<` karşılaştırması bugünkü evrakı elerdi.
   */
  it("saatli vade gün başına yuvarlanır", () => {
    const kalemler = kiymetleriKalemeCevir(
      [cek({ dueDate: new Date(2026, 8, 7, 15, 30), amount: 33 })],
      BUGUN
    )
    expect(kalemler.map((k) => k.amount)).toEqual([33])
  })

  it("bozuk tutar ve bozuk vade eğriyi kaydırmaz", () => {
    const kalemler = kiymetleriKalemeCevir(
      [
        cek({ amount: 0 }),
        cek({ amount: -500 }),
        cek({ amount: "abc" }),
        cek({ dueDate: new Date("gecersiz") }),
      ],
      BUGUN
    )
    expect(kalemler).toEqual([])
  })

  /**
   * Asıl kazanç: kova aritmetiğiyle birleşince ileri vadeli çek kendi
   * HAFTASINA düşmeli. Eskiden bu para hiçbir kovada yoktu.
   */
  it("kovaya kendi vadesinde düşer ve bakiyeyi o hafta yükseltir", () => {
    const projeksiyon = buildCashProjection({
      today: BUGUN,
      openingBalance: 50000,
      granularity: "week",
      bucketCount: 4,
      items: kiymetleriKalemeCevir(
        [cek({ dueDate: new Date(2026, 8, 20), amount: 100000 })],
        BUGUN
      ),
    })

    // 20 Eylül 2026 → 7 Eylül haftasından iki hafta sonra (14-20 Eyl).
    expect(projeksiyon.buckets[0].inflow).toBe(0)
    expect(projeksiyon.buckets[1].inflow).toBe(100000)
    expect(projeksiyon.buckets[1].balance).toBe(150000)
    expect(projeksiyon.overdue.inflow).toBe(0)
    expect(projeksiyon.undated.inflow).toBe(0)
  })
})
