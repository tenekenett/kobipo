import { describe, it, expect, afterEach } from "vitest"
import { fisTaramaAcikMi } from "./access"

const eski = process.env.FIS_TARAMA_COMPANIES
afterEach(() => {
  if (eski === undefined) delete process.env.FIS_TARAMA_COMPANIES
  else process.env.FIS_TARAMA_COMPANIES = eski
})

describe("fisTaramaAcikMi", () => {
  it("liste tanımsızken hiç kimseye açılmaz (fail-closed)", () => {
    delete process.env.FIS_TARAMA_COMPANIES
    expect(fisTaramaAcikMi({ id: "abc", slug: "market" })).toBe(false)
  })

  it("liste boşken de kapalıdır", () => {
    process.env.FIS_TARAMA_COMPANIES = "   "
    expect(fisTaramaAcikMi({ id: "abc", slug: "market" })).toBe(false)
  })

  it("slug ile eşleşir", () => {
    process.env.FIS_TARAMA_COMPANIES = "ornek-market,baska-firma"
    expect(fisTaramaAcikMi({ id: "abc", slug: "ornek-market" })).toBe(true)
  })

  it("id ile eşleşir", () => {
    process.env.FIS_TARAMA_COMPANIES = "cmf3x9k2p0001abcd"
    expect(fisTaramaAcikMi({ id: "cmf3x9k2p0001abcd", slug: "market" })).toBe(true)
  })

  it("büyük/küçük harf ve boşluk toleranslıdır", () => {
    process.env.FIS_TARAMA_COMPANIES = " Ornek-Market ,  digeri "
    expect(fisTaramaAcikMi({ id: null, slug: "ornek-market" })).toBe(true)
    expect(fisTaramaAcikMi({ id: null, slug: "digeri" })).toBe(true)
  })

  it("listede olmayan firmayı reddeder", () => {
    process.env.FIS_TARAMA_COMPANIES = "ornek-market"
    expect(fisTaramaAcikMi({ id: "abc", slug: "baska" })).toBe(false)
    expect(fisTaramaAcikMi(null)).toBe(false)
  })
})
