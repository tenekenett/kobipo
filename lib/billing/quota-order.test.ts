/**
 * Modülsüz ("yalnız kota") siparişin açılma kapısı.
 *
 * Buradaki bir hata doğrudan karşılıksız tahsilat demek: kota takviyesi dönemi uzatmaz
 * ve modüllere dokunmaz, dolayısıyla kotayı da artırmıyorsa müşteri paranın karşılığında
 * hiçbir şey almaz. Aktif olmayan abonelikte ise kota yükselse bile kullanılamaz
 * (`getAccountQuotas` fail-closed).
 */

import { describe, expect, it } from "vitest"
import { checkQuotaOnlyOrder } from "./quota-order"

const sub = (over: Partial<{ branchQuota: number; companyQuota: number; active: boolean }> = {}) => ({
  branchQuota: 0,
  companyQuota: 0,
  active: true,
  ...over,
})

describe("checkQuotaOnlyOrder", () => {
  it("modül/paket içeren siparişe hiç karışmaz", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: false,
      branchQuota: 0,
      companyQuota: 0,
      existing: sub({ branchQuota: 5 }),
    })
    expect(out.ok).toBe(true)
  })

  it("abonelik satırı hiç yoksa geçer — takviye değil, yeni satır açılır", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 2,
      companyQuota: 0,
      existing: null,
    })
    expect(out.ok).toBe(true)
  })

  it("kota artıyorsa geçer", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 3,
      companyQuota: 0,
      existing: sub({ branchQuota: 1 }),
    })
    expect(out.ok).toBe(true)
  })

  it("yalnız DİĞER kota artıyorsa da geçer", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 0,
      companyQuota: 2,
      existing: sub({ branchQuota: 3, companyQuota: 1 }),
    })
    expect(out.ok).toBe(true)
  })

  it("kota artmıyorsa REDDEDİLİR — dönem uzamayacağı için karşılıksız ödeme olurdu", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 3,
      companyQuota: 1,
      existing: sub({ branchQuota: 3, companyQuota: 1 }),
    })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain("zaten bu seviyede")
  })

  it("takviye kota düşüremediği için 'daha az' istemek de reddedilir", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 1,
      companyQuota: 0,
      existing: sub({ branchQuota: 3 }),
    })
    expect(out.ok).toBe(false)
  })

  it("abonelik aktif değilse reddedilir — alınan kota kullanılamazdı", () => {
    const out = checkQuotaOnlyOrder({
      quotaOnly: true,
      branchQuota: 5,
      companyQuota: 0,
      existing: sub({ branchQuota: 1, active: false }),
    })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain("aktif")
  })
})
