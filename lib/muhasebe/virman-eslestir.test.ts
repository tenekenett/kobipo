import { describe, expect, it } from "vitest"
import { virmanEslestir, type VirmanBacagi } from "./virman-eslestir"

const bacak = (b: Partial<VirmanBacagi> & Pick<VirmanBacagi, "id">): VirmanBacagi => ({
  companyId: "c1",
  accountId: "kasa",
  date: new Date("2026-10-05T09:00:00Z"),
  type: "TRANSFER",
  amount: 500,
  reference: "TRANSFER:banka",
  transferGroupId: null,
  ...b,
})
const giris = (b: Partial<VirmanBacagi> & Pick<VirmanBacagi, "id">) =>
  bacak({ type: "INCOME", accountId: "banka", reference: "TRANSFER:kasa", ...b })

describe("virmanEslestir", () => {
  it("ortak kimlikli bacaklar tutar/gün tutmasa da eşleşir", () => {
    const cift = virmanEslestir([
      bacak({ id: "k1", transferGroupId: "g1" }),
      giris({ id: "h1", transferGroupId: "g1", amount: 999, date: new Date("2026-12-01") }),
    ])
    expect(cift.get("k1")).toBe("h1")
    expect(cift.get("h1")).toBe("k1")
  })

  it("aynı gün iki eş tutarlı virmanda ortak kimlik doğru eşi seçer (eski kural id sırasıyla eşlerdi)", () => {
    const cift = virmanEslestir([
      bacak({ id: "k1", transferGroupId: "g2" }),
      bacak({ id: "k2", transferGroupId: "g1" }),
      giris({ id: "h1", transferGroupId: "g1" }),
      giris({ id: "h2", transferGroupId: "g2" }),
    ])
    expect(cift.get("k1")).toBe("h2")
    expect(cift.get("k2")).toBe("h1")
  })

  it("kimliksiz eski bacaklar tutar + gün + referansla eşleşir; kimlikli bacak eski kurala katılmaz", () => {
    const cift = virmanEslestir([
      bacak({ id: "k1" }),
      giris({ id: "h1", amount: "500.00" }),
      giris({ id: "h9", transferGroupId: "baska" }),
    ])
    expect(cift.get("k1")).toBe("h1")
    expect(cift.has("h9")).toBe(false)
  })

  it("eski kural: farklı gün, farklı tutar ya da başka kasa eşleşmez", () => {
    expect(virmanEslestir([bacak({ id: "k1" }), giris({ id: "h1", date: new Date("2026-10-07T09:00:00Z") })]).size).toBe(0)
    expect(virmanEslestir([bacak({ id: "k1" }), giris({ id: "h1", amount: 501 })]).size).toBe(0)
    expect(virmanEslestir([bacak({ id: "k1" }), giris({ id: "h1", accountId: "baska-banka" })]).size).toBe(0)
  })
})
