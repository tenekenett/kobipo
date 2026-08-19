import { describe, expect, it } from "vitest"
import { findRoleNameConflict, normalizeRoleName, roleWriteTarget } from "@/lib/nav/role-conflict"

const roles = [
  { id: "r1", name: "Satış Temsilcisi" },
  { id: "r2", name: "Garson" },
]

describe("normalizeRoleName", () => {
  it("kenar boşluklarını ve harf büyüklüğünü yok sayar", () => {
    expect(normalizeRoleName("  GARSON ")).toBe(normalizeRoleName("garson"))
  })

  it("Türkçe I/İ ayrımını korur", () => {
    // Varsayılan locale ile ikisi de "istanbul" olur ve DB'nin ayrı tuttuğu iki ad
    // aynı sayılırdı.
    expect(normalizeRoleName("IŞIKÇI")).not.toBe(normalizeRoleName("İŞIKÇI"))
  })
})

describe("findRoleNameConflict", () => {
  it("aynı adı yakalar", () => {
    expect(findRoleNameConflict(roles, "garson", null)?.id).toBe("r2")
  })

  it("rolü kendi adıyla kaydetmek çakışma değildir", () => {
    expect(findRoleNameConflict(roles, "Garson", "r2")).toBeNull()
  })

  it("başka bir rolü düzenlerken çakışma yine görülür", () => {
    expect(findRoleNameConflict(roles, "Garson", "r1")?.id).toBe("r2")
  })

  it("boş ad ve boş liste çakışma üretmez", () => {
    expect(findRoleNameConflict(roles, "   ", null)).toBeNull()
    expect(findRoleNameConflict([], "Garson", null)).toBeNull()
    expect(findRoleNameConflict(undefined, "Garson", null)).toBeNull()
  })
})

describe("roleWriteTarget", () => {
  it("yeni ve benzersiz ad → POST (hedef yok)", () => {
    expect(roleWriteTarget(null, null)).toBeNull()
  })

  it("düzenlenen rol varsa hedef odur", () => {
    expect(roleWriteTarget("r1", null)).toBe("r1")
  })

  // Asıl regresyon: kalıp kartından/ekip ekranından açılan "yeni rol" formunda
  // mevcut bir ad yazılıysa POST atılmaz — 409'un tek üretebileceği şey buydu.
  it("çakışan ad → yeni rol açmak yerine mevcut rol güncellenir", () => {
    expect(roleWriteTarget(null, roles[1])).toBe("r2")
  })

  it("düzenlenen rol, çakışmadan önce gelir", () => {
    expect(roleWriteTarget("r1", roles[1])).toBe("r1")
  })
})
