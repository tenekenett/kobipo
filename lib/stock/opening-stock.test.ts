import { describe, expect, it } from "vitest"
import { planOpeningStock } from "./opening-stock"

describe("planOpeningStock", () => {
  it("açılış hareketi varsa farkı bakiyeye işler, harekete HEDEFİ yazar", () => {
    // Açılış 100, sonrasında 30 satılmış → kart 70, hareket toplamı 70.
    const plan = planOpeningStock({
      target: 120,
      cardQuantity: 70,
      movementSum: 70,
      openingMovementQuantity: 100,
    })
    expect(plan).toEqual({ ok: true, previous: 100, delta: 20, movementQuantity: 120 })
  })

  it("hareketi olmayan ESKİ üründe açılış kalıntıdan okunur (çift sayma olmaz)", () => {
    // Kart 100 ama defterde tek satır yok → açılış 100 sayılır, 100 yazmak fark üretmez.
    const same = planOpeningStock({
      target: 100,
      cardQuantity: 100,
      movementSum: 0,
      openingMovementQuantity: null,
    })
    expect(same).toEqual({ ok: true, previous: 100, delta: 0, movementQuantity: 100 })

    // 150'ye çıkarınca kart yalnız 50 artar; hareket 150 olarak yazılır.
    const raised = planOpeningStock({
      target: 150,
      cardQuantity: 100,
      movementSum: 0,
      openingMovementQuantity: null,
    })
    expect(raised).toEqual({ ok: true, previous: 100, delta: 50, movementQuantity: 150 })
  })

  it("eski üründe sonradan hareket girilmişse kalıntı yine doğru: kart − Σhareket", () => {
    // Kart 100 ile doğmuş, sonra 40 satılmış: kart 60, Σhareket -40 → açılış 100.
    const plan = planOpeningStock({
      target: 100,
      cardQuantity: 60,
      movementSum: -40,
      openingMovementQuantity: null,
    })
    expect(plan).toEqual({ ok: true, previous: 100, delta: 0, movementQuantity: 100 })
  })

  it("bakiyeyi negatife düşürecek azaltma reddedilir", () => {
    // Açılış 100, 90'ı satılmış → kart 10. Açılışı 5 yapmak bakiyeyi -85 yapardı.
    const plan = planOpeningStock({
      target: 5,
      cardQuantity: 10,
      movementSum: 10,
      openingMovementQuantity: 100,
    })
    expect(plan.ok).toBe(false)
    expect((plan as { error: string }).error).toContain("90")
  })

  it("negatif hedef ve sayı olmayan girdi reddedilir", () => {
    expect(
      planOpeningStock({ target: -1, cardQuantity: 0, movementSum: 0, openingMovementQuantity: null }).ok,
    ).toBe(false)
    expect(
      planOpeningStock({ target: NaN, cardQuantity: 0, movementSum: 0, openingMovementQuantity: null }).ok,
    ).toBe(false)
  })

  it("ondalıklar 4 haneye yuvarlanır (reçete bileşen hassasiyeti)", () => {
    const plan = planOpeningStock({
      target: 0.30000000000000004,
      cardQuantity: 0.1,
      movementSum: 0.1,
      openingMovementQuantity: 0.1,
    })
    expect(plan).toEqual({ ok: true, previous: 0.1, delta: 0.2, movementQuantity: 0.3 })
  })
})
