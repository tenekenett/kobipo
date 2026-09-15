import { describe, expect, it } from "vitest"
import {
  BranchIdentityLockedError,
  assertBranchIdentityLocked,
  propagateIdentityToBranches,
} from "./branch-identity"

const branch = {
  parentCompanyId: "parent",
  taxNumber: "1234567890",
  taxOffice: "Kadıköy",
  isEDonusumEnabled: true,
  eDonusumApiUsername: "user",
  eFaturaPrefix: "ABC",
}

describe("assertBranchIdentityLocked", () => {
  it("ana firmada (parent yok) hiçbir alanı kilitlemez", () => {
    expect(() =>
      assertBranchIdentityLocked({ ...branch, parentCompanyId: null }, { taxNumber: "9999999999" }),
    ).not.toThrow()
  })

  it("şubede VKN değişikliğini reddeder, hangi alanların değiştiğini söyler", () => {
    let caught: unknown
    try {
      assertBranchIdentityLocked(branch, { taxNumber: "9999999999", taxOffice: "Kadıköy", phone: "555" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BranchIdentityLockedError)
    expect((caught as BranchIdentityLockedError).fields).toEqual(["taxNumber"])
    expect((caught as BranchIdentityLockedError).messageTr).toContain("Vergi No")
    expect((caught as BranchIdentityLockedError).messageTr).toContain("ana firmadan devralınır")
  })

  it("formun yolladığı DEĞİŞMEMİŞ alanlar hata değildir (boşluk/maske dâhil)", () => {
    expect(() =>
      assertBranchIdentityLocked(branch, {
        taxNumber: " 1234567890 ",
        taxOffice: "Kadıköy",
        isEDonusumEnabled: true,
        eDonusumApiUsername: "user",
        eDonusumApiPassword: "***",
        eFaturaPrefix: "ABC",
        address: "yeni adres",
      }),
    ).not.toThrow()
  })

  it("şubede e-Dönüşüm şifresi yazılamaz, boolean farkı yakalanır", () => {
    expect(() => assertBranchIdentityLocked(branch, { eDonusumApiPassword: "gizli" })).toThrow(BranchIdentityLockedError)
    expect(() => assertBranchIdentityLocked(branch, { isEDonusumEnabled: false })).toThrow(BranchIdentityLockedError)
  })
})

describe("propagateIdentityToBranches", () => {
  it("yalnız kilitli alanlardan tanımlı olanları şubelere yazar", async () => {
    const calls: unknown[] = []
    const db = {
      company: {
        updateMany: async (args: unknown) => {
          calls.push(args)
          return { count: 2 }
        },
      },
    }
    const count = await propagateIdentityToBranches(db as never, "parent", {
      taxNumber: "111",
      eFaturaPrefix: null,
      address: "adres",
      name: "Ünvan",
      eArchivePrefix: undefined,
    })
    expect(count).toBe(2)
    expect(calls[0]).toEqual({
      where: { parentCompanyId: "parent" },
      data: { taxNumber: "111", eFaturaPrefix: null },
    })
  })

  it("kilitli alan yoksa sorgu atmaz", async () => {
    const db = { company: { updateMany: async () => { throw new Error("çağrılmamalı") } } }
    await expect(propagateIdentityToBranches(db as never, "parent", { address: "x" })).resolves.toBe(0)
  })
})
