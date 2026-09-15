import { describe, expect, it } from "vitest"
import { ForeignRecordError, assertOwned, foreignRecordFrom } from "./owned"

/** Sahte veritabanı: model → firma → id kümesi. */
function fakeDb(owned: Record<string, Record<string, string[]>>) {
  const delegate = (model: string) => ({
    count: async ({ where }: { where: { id: { in: string[] }; companyId: string } }) =>
      where.id.in.filter((id) => (owned[model]?.[where.companyId] ?? []).includes(id)).length,
    findMany: async ({ where }: { where: { id: { in: string[] }; companyId: string } }) =>
      where.id.in
        .filter((id) => (owned[model]?.[where.companyId] ?? []).includes(id))
        .map((id) => ({ id })),
  })
  return new Proxy({}, { get: (_t, model: string) => delegate(model) }) as never
}

const db = fakeDb({
  product: { A: ["p1", "p2"], B: ["p9"] },
  customer: { A: ["c1"], B: ["c9"] },
  warehouse: { A: ["w1", "w2"], B: ["w9"] },
})

describe("assertOwned", () => {
  it("kendi firmasının kayıtlarında sessiz geçer", async () => {
    await expect(
      assertOwned(db, "A", { product: ["p1", "p2", "p1"], customer: "c1", warehouse: ["w1", "w2"] }),
    ).resolves.toBeUndefined()
  })

  it("boş / null / undefined / boşluk id'leri doğrulamaya sokmaz", async () => {
    await expect(
      assertOwned(db, "A", { product: [null, undefined, "  ", ""], customer: null, supplier: undefined }),
    ).resolves.toBeUndefined()
  })

  it("başka firmanın ürününde ForeignRecordError fırlatır ve yabancı id'leri listeler", async () => {
    let caught: unknown
    try {
      await assertOwned(db, "A", { product: ["p1", "p9", "olmayan"] })
    } catch (e) {
      caught = e
    }
    const err = foreignRecordFrom(caught)
    expect(err).toBeInstanceOf(ForeignRecordError)
    expect(err!.model).toBe("product")
    expect(err!.ids).toEqual(["p9", "olmayan"])
    // Route catch'leri bu ön eke bakıp accessDeniedResponse'a yollar.
    expect(err!.message.startsWith("Access denied")).toBe(true)
    // Kullanıcı metni id basmaz.
    expect(err!.messageTr).not.toContain("p9")
    expect(err!.messageTr).toContain("ürün")
  })

  it("tek yabancı cari için tekil cümle kurar", async () => {
    await expect(assertOwned(db, "A", { customer: "c9" })).rejects.toMatchObject({
      model: "customer",
      ids: ["c9"],
      messageTr: "Seçilen müşteri bu firmaya ait değil. Sayfayı yenileyip tekrar seçin.",
    })
  })

  it("aynı istekte birden çok model: ilk yabancı olanı raporlar, hepsini kontrol eder", async () => {
    await expect(assertOwned(db, "B", { product: "p9", warehouse: ["w9", "w1"] })).rejects.toMatchObject({
      model: "warehouse",
      ids: ["w1"],
    })
  })
})
