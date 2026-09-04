/**
 * ABONELİK EKRANININ testleri.
 *
 * Bu proje bileşen testi tutmuyor (bkz. vitest.config.ts): ekranın kararları saf
 * fonksiyonlara taşındı ve kilit burada. İki bölüm var —
 *   1. kararların kendisi,
 *   2. EKRAN ≡ UÇ sözleşmesi: aynı olguda ekranın ve sunucunun aynı cevabı vermesi.
 * İkincisi olmadan 2026-09-04'teki hata sınıfı geri gelir (sunucu değişti, ekran kaldı).
 */

import { describe, expect, it } from "vitest"
import {
  purchaseNoticeFor,
  resolvePayButton,
  resolveQuotaSelection,
  showsQuotaCards,
} from "./subscription-screen"
import { resolvePurchaseAuthority } from "./purchase-authority"

const pay = (over: Partial<Parameters<typeof resolvePayButton>[0]> = {}) =>
  resolvePayButton({
    quotaTopUpBlocked: false,
    paytrEnabled: true,
    canPurchase: true,
    amount: 495,
    resolvedModules: ["restaurant"],
    branchQuota: 0,
    companyQuota: 0,
    ...over,
  })

describe("resolveQuotaSelection", () => {
  it("hesap kökünde seçilen kota olduğu gibi gider", () => {
    expect(
      resolveQuotaSelection({ isAccountRoot: true, branchQuota: 5, companyQuota: 8 }),
    ).toEqual({ branchQuota: 5, companyQuota: 8 })
  })

  it("ŞUBE/EK FİRMA ekranında kota SIFIRLANIR — uç 400 döndürürdü", () => {
    expect(
      resolveQuotaSelection({ isAccountRoot: false, branchQuota: 5, companyQuota: 8 }),
    ).toEqual({ branchQuota: 0, companyQuota: 0 })
  })

  it("paket kotayla gelse bile üyede tutara girmez", () => {
    // Paketin `includedBranches`ı seçime ekleniyor; kartı gizlemek yetmez, tutar da
    // sıfırlanmalı yoksa ekranda görünen tutar tahsilattan ayrışır.
    expect(resolveQuotaSelection({ isAccountRoot: false, branchQuota: 3, companyQuota: 0 })
      .branchQuota).toBe(0)
  })

  it("negatif değer taşınmaz", () => {
    expect(
      resolveQuotaSelection({ isAccountRoot: true, branchQuota: -2, companyQuota: -1 }),
    ).toEqual({ branchQuota: 0, companyQuota: 0 })
  })
})

describe("showsQuotaCards", () => {
  it("kota kartları yalnız hesap kökünde", () => {
    expect(showsQuotaCards(true)).toBe(true)
    expect(showsQuotaCards(false)).toBe(false)
  })
})

describe("resolvePayButton", () => {
  it("her şey yerindeyse açık", () => {
    expect(pay()).toEqual({ enabled: true, blockedBy: null })
  })

  it("satın alma yetkisi yoksa kapalı", () => {
    expect(pay({ canPurchase: false })).toEqual({ enabled: false, blockedBy: "authority" })
  })

  it("sanal POS yapılandırılmamışsa kapalı", () => {
    expect(pay({ paytrEnabled: false }).blockedBy).toBe("paytr")
  })

  it("yalnız-kota siparişi sunucudaki kapıya takılıyorsa kapalı", () => {
    expect(pay({ quotaTopUpBlocked: true }).blockedBy).toBe("quota-top-up")
  })

  it("hiçbir şey seçilmemişse kapalı", () => {
    expect(pay({ resolvedModules: [], amount: 0 }).blockedBy).toBe("empty-selection")
  })

  it("tutar sıfırsa modül seçili olsa bile kapalı", () => {
    // Ücretsiz modüller tutar üretmez; "bedava sipariş" ancak %100 kuponla olur ve o
    // yolda tutar indirim UYGULANMADAN önce pozitiftir.
    expect(pay({ amount: 0 }).blockedBy).toBe("empty-selection")
  })

  it("modülsüz ama kotalı seçim ödenebilir", () => {
    expect(pay({ resolvedModules: [], branchQuota: 2, amount: 20 }).enabled).toBe(true)
  })

  it("sebep sırası: sunucunun reddedeceği durum, seçim boşluğundan ÖNCE bildirilir", () => {
    // Aksi halde yetkisiz kullanıcıya "bir şey seçin" denir, seçince yine kapalı kalırdı.
    expect(pay({ canPurchase: false, resolvedModules: [], amount: 0 }).blockedBy).toBe(
      "authority",
    )
  })
})

describe("purchaseNoticeFor", () => {
  it("firma yöneticisi olmayana doğru cümle", () => {
    expect(purchaseNoticeFor("not-admin")).toContain("firma yöneticisine")
  })

  it("hesap yöneticisi olmayana ANA FİRMANIN adı geçer", () => {
    const msg = purchaseNoticeFor("not-account-admin", "Reypo Medya Ajansı")
    expect(msg).toContain("hesap yöneticisi")
    expect(msg).toContain("Reypo Medya Ajansı")
  })

  it("hesap adı bilinmiyorsa boş parantez bırakmaz", () => {
    expect(purchaseNoticeFor("not-account-admin", null)).not.toContain("(")
  })

  it("engel yoksa cümle de yok", () => {
    expect(purchaseNoticeFor(null)).toBeNull()
  })
})

/**
 * EKRAN ≡ UÇ. `catalog` ucu `resolvePurchaseAuthority`nin sonucunu `canPurchase` +
 * `purchaseBlockedReason` olarak yolluyor; ekran da onu düğmeye ve uyarıya çeviriyor.
 * Bu blok zinciri uçtan uca sınar: aynı olguda uç ne diyorsa ekran onu göstermeli.
 */
describe("ekran ile uç aynı cevabı verir", () => {
  const cases = [
    { ad: "kökün ADMIN'i", companyRole: "ADMIN", isAccountRoot: true, isAccountRootAdmin: false },
    { ad: "kökte ADMIN olmayan", companyRole: "VIEWER", isAccountRoot: true, isAccountRootAdmin: false },
    { ad: "şubede ADMIN, hesapta değil", companyRole: "ADMIN", isAccountRoot: false, isAccountRootAdmin: false },
    { ad: "şubede ADMIN, hesapta da ADMIN", companyRole: "ADMIN", isAccountRoot: false, isAccountRootAdmin: true },
    { ad: "şubede ADMIN olmayan", companyRole: "BRANCH_MANAGER", isAccountRoot: false, isAccountRootAdmin: true },
  ] as const

  for (const c of cases) {
    it(`${c.ad}: uç izin vermiyorsa düğme de kapalı ve sebebi yazılı`, () => {
      const authority = resolvePurchaseAuthority({
        companyRole: c.companyRole,
        isAccountRoot: c.isAccountRoot,
        isSuperAdmin: false,
        isAccountRootAdmin: c.isAccountRootAdmin,
      })
      const button = pay({ canPurchase: authority.ok })

      expect(button.enabled).toBe(authority.ok)
      if (!authority.ok) {
        expect(button.blockedBy).toBe("authority")
        // Kullanıcı neden ödeyemediğini ekranda okuyabilmeli.
        expect(purchaseNoticeFor(authority.reason, "Ana Firma")).toBeTruthy()
      } else {
        expect(purchaseNoticeFor(authority.reason)).toBeNull()
      }
    })
  }

  it("uç engellemezken ekran kendiliğinden kapatmaz", () => {
    const authority = resolvePurchaseAuthority({
      companyRole: "ADMIN",
      isAccountRoot: true,
      isSuperAdmin: false,
      isAccountRootAdmin: false,
    })
    expect(authority.ok).toBe(true)
    expect(pay({ canPurchase: true }).enabled).toBe(true)
  })
})
