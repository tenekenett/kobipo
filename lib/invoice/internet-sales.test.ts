import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildInternetSalesInfo,
  parseInternetSalesInfo,
  PAYTR_LEGAL_NAME,
  resolveWebSiteUrl,
} from "./internet-sales"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("buildInternetSalesInfo", () => {
  it("kartlı ödemede ödeme aracısını ve ödeme tarihini yazar", () => {
    const info = buildInternetSalesInfo({
      paymentMethod: "CARD",
      paidAt: new Date("2026-08-24T09:15:00Z"),
    })
    expect(info.paymentType).toBe("KREDIKARTI/BANKAKARTI")
    expect(info.internetAccountName).toBe(PAYTR_LEGAL_NAME)
    // Ödeme tarihi kartlı satışta belgede zorunlu alandır.
    expect(info.paymentDate).toBe("2026-08-24")
  })

  it("havalede ödeme aracısı yazmaz", () => {
    const info = buildInternetSalesInfo({ paymentMethod: "HAVALE", paidAt: new Date() })
    expect(info.paymentType).toBe("EFT/HAVALE")
    expect(info.internetAccountName).toBeUndefined()
  })

  it("tarihi Türkiye takvimine göre verir (UTC gece yarısı kayması olmasın)", () => {
    // 23:30 UTC = ertesi gün 02:30 TR — belge tarihi mükellefin gününe göre yazılmalı.
    const info = buildInternetSalesInfo({
      paymentMethod: "CARD",
      paidAt: new Date("2026-08-24T23:30:00Z"),
    })
    expect(info.paymentDate).toBe("2026-08-25")
  })
})

describe("resolveWebSiteUrl", () => {
  it("yerel adres yerine kurumsal adrese düşer", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveWebSiteUrl()).toBe("https://kobipo.com")
  })

  it("gerçek adresi sondaki eğik çizgi olmadan kullanır", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://panel.kobipo.com/")
    expect(resolveWebSiteUrl()).toBe("https://panel.kobipo.com")
  })
})

describe("parseInternetSalesInfo", () => {
  it("tanınmayan ödeme şeklini reddeder (yarım bilgi belgeye gitmesin)", () => {
    expect(parseInternetSalesInfo({ paymentType: "BITCOIN" })).toBeNull()
    expect(parseInternetSalesInfo({})).toBeNull()
    expect(parseInternetSalesInfo(null)).toBeNull()
    expect(parseInternetSalesInfo("EFT/HAVALE")).toBeNull()
  })

  it("geçerli kaydı tipli nesneye çevirir", () => {
    const parsed = parseInternetSalesInfo({
      paymentType: "EFT/HAVALE",
      webSiteUrl: "https://kobipo.com",
      paymentDate: "2026-08-24",
      internetAccountName: "  ",
    })
    expect(parsed).toEqual({
      paymentType: "EFT/HAVALE",
      webSiteUrl: "https://kobipo.com",
      paymentDate: "2026-08-24",
      internetAccountName: undefined,
      paymentNote: undefined,
    })
  })
})
