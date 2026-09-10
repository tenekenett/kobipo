import { describe, expect, it } from "vitest"
import {
  CARI_VISIBILITY_ALL,
  CariForbiddenError,
  assertCariVisible,
  cariForbiddenFrom,
  cariRelationVisibilityWhere,
  cariVisibilityFor,
  cariVisibilityWhere,
  hasFullCariAccess,
  isCariVisible,
  resolveAuthorizedUserIdOnWrite,
} from "./visibility"

const AYSE = "user_ayse"
const MEHMET = "user_mehmet"

describe("cari görünürlüğü — kimin ne gördüğü", () => {
  it("yönetici ve şube müdürü tüm carileri görür", () => {
    expect(cariVisibilityFor("ADMIN", AYSE, false)).toEqual(CARI_VISIBILITY_ALL)
    expect(cariVisibilityFor("BRANCH_MANAGER", AYSE, false)).toEqual(CARI_VISIBILITY_ALL)
  })

  /**
   * Muhasebeci kısıtlıyken rol çalışmıyordu: cari ekranları boş açılıyor ve liste ucu
   * belge ekranlarının müşteri seçicisi olduğu için hiçbir cariye fatura kesilemiyordu.
   * Kısıtın hedefi satışçıdır; muhasebeciyi geri kısıtlamak o hatayı geri getirir.
   */
  it("muhasebeci tüm carileri görür", () => {
    expect(cariVisibilityFor("ACCOUNTANT", AYSE, false)).toEqual(CARI_VISIBILITY_ALL)
    expect(hasFullCariAccess("ACCOUNTANT")).toBe(true)
  })

  it("süper-admin rolü ne olursa olsun tüm carileri görür (destek erişimi)", () => {
    expect(cariVisibilityFor("SALES", AYSE, true)).toEqual(CARI_VISIBILITY_ALL)
  })

  /**
   * Özel rol (CUSTOM) bilerek kısıtlıdır: hesap yönetimi sayfalarını alamadığı
   * için "yönetici" sayılamaz. Gevşetilirse firmanın tanımladığı her rol tüm
   * cari listesini görür ve kısıt anlamını yitirir.
   */
  it("satış, stok, gözlemci ve özel rol yalnız kendine atananı görür", () => {
    for (const role of ["SALES", "STOCK", "VIEWER", "CUSTOM"]) {
      expect(cariVisibilityFor(role, AYSE, false)).toEqual({ kind: "own", userId: AYSE })
      expect(hasFullCariAccess(role)).toBe(false)
    }
  })

  it("atanmamış cariyi kısıtlı çalışan GÖREMEZ, yönetici görür", () => {
    const atanmamis = { authorizedUserId: null }
    expect(isCariVisible(atanmamis, { kind: "own", userId: AYSE })).toBe(false)
    expect(isCariVisible(atanmamis, CARI_VISIBILITY_ALL)).toBe(true)
  })

  it("başkasına atanmış cari görünmez", () => {
    expect(isCariVisible({ authorizedUserId: MEHMET }, { kind: "own", userId: AYSE })).toBe(false)
    expect(isCariVisible({ authorizedUserId: AYSE }, { kind: "own", userId: AYSE })).toBe(true)
  })

  it("assertCariVisible görünmeyende 403 hatası fırlatır", () => {
    expect(() => assertCariVisible({ authorizedUserId: null }, CARI_VISIBILITY_ALL)).not.toThrow()
    expect(() =>
      assertCariVisible({ authorizedUserId: MEHMET }, { kind: "own", userId: AYSE }),
    ).toThrow(CariForbiddenError)
  })

  /**
   * Mesaj "Access denied" ile başlamalı: helper'a geçmemiş uçlar 403'e bu
   * ifadeye bakarak mapliyor. Kırılırsa o uçlar 500 döndürmeye başlar.
   */
  it("hata mesajı 'Access denied' ile başlar ve geri tanınabilir", () => {
    const error = new CariForbiddenError()
    expect(error.message).toContain("Access denied")
    expect(cariForbiddenFrom(error)).toBeInstanceOf(CariForbiddenError)
    expect(cariForbiddenFrom(new Error(error.message))).toBeInstanceOf(CariForbiddenError)
    expect(cariForbiddenFrom(new Error("Access denied to this company"))).toBeNull()
  })
})

describe("sorgu parçaları", () => {
  /** "all" boş nesne dönmeli: yöneticinin ve otomasyonun sorgusu bugünküyle birebir kalsın. */
  it("yöneticide where parçaları boştur", () => {
    expect(cariVisibilityWhere(CARI_VISIBILITY_ALL)).toEqual({})
    expect(cariRelationVisibilityWhere(CARI_VISIBILITY_ALL)).toEqual({})
  })

  it("kısıtlıda cari tablosu authorizedUserId ile süzülür", () => {
    expect(cariVisibilityWhere({ kind: "own", userId: AYSE })).toEqual({ authorizedUserId: AYSE })
  })

  /** Ekstre hem müşteri hem tedarikçi tarafından hareket toplar; ikisi de kapsanmalı. */
  it("bağlı kayıtta müşteri VEYA tedarikçi ataması aranır", () => {
    expect(cariRelationVisibilityWhere({ kind: "own", userId: AYSE })).toEqual({
      OR: [
        { customer: { authorizedUserId: AYSE } },
        { supplier: { authorizedUserId: AYSE } },
      ],
    })
  })
})

describe("yazarken atama", () => {
  it("yönetici serbesttir: verdiğini yazar, boş bırakabilir", () => {
    expect(resolveAuthorizedUserIdOnWrite(MEHMET, CARI_VISIBILITY_ALL)).toBe(MEHMET)
    expect(resolveAuthorizedUserIdOnWrite(null, CARI_VISIBILITY_ALL)).toBeNull()
  })

  /**
   * Kısıtlı kullanıcı ne gönderirse göndersin kayıt kendisine yazılır: boş
   * bırakılırsa yeni cari daha ilk yüklemede listesinden düşerdi, başkasını
   * seçebilseydi gördüğü cariyi geri alamayacak şekilde devredebilirdi.
   */
  it("kısıtlı kullanıcıda atama HER ZAMAN kendisidir", () => {
    const own = { kind: "own", userId: AYSE } as const
    expect(resolveAuthorizedUserIdOnWrite(null, own)).toBe(AYSE)
    expect(resolveAuthorizedUserIdOnWrite(MEHMET, own)).toBe(AYSE)
  })
})
