import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { MysoftEInvoiceProvider } from "./mysoft-provider"

/**
 * GELEN KUTUSU — 90 GÜNLÜK PENCERE BÖLMESİ.
 *
 * Regresyon: ekran "Son 6 ay" / "Son 1 yıl" sunuyordu ama Mysoft dönem uçları
 * "Başlangıç bitiş tarihi arasında 90 günden fazla zaman olamaz" diyerek isteğin
 * TAMAMINI reddediyordu — kullanıcı hiç veri alamıyordu. Artık aralık ≤90 günlük
 * ardışık pencerelere bölünüp sırayla çekiliyor.
 */

const DAY = 24 * 60 * 60 * 1000

let provider: MysoftEInvoiceProvider
let bodies: Array<{ startDate: string; endDate: string; pageNumber: number; pageSize: number }>

/** fetch'i, her pencere için verilen yanıtı döndürecek şekilde taklit eder. */
const mockFetch = (respond: (body: any, callIndex: number) => any) => {
  bodies = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      const payload = respond(body, bodies.length - 1)
      return { status: 200, json: async () => payload } as any
    }),
  )
}

const invoice = (ettn: string) => ({
  ettn,
  docNo: `INV-${ettn}`,
  docDate: "2026-05-01T00:00:00",
  payableAmount: 100,
  accountName: "ABC Gıda",
  vknTckn: "1234567890",
})

beforeEach(() => {
  provider = new MysoftEInvoiceProvider({
    username: "u",
    passwordText: "p",
    baseUrl: "https://example.invalid",
    vknTckn: "1111111114",
  })
  vi.spyOn(provider as any, "getToken").mockResolvedValue("tok")
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("listIncomingInvoices — 90 gün penceresi", () => {
  it("1 yıllık aralığı 90 günü aşmayan ardışık pencerelere böler ve aralığın tamamını kapsar", async () => {
    mockFetch((body) => ({
      succeed: true,
      totalCount: 1,
      data: [invoice(`e-${body.startDate}`)],
    }))

    const end = new Date("2026-08-30T12:00:00.000Z")
    const start = new Date(end.getTime() - 365 * DAY)
    const result = await provider.listIncomingInvoices({ startDate: start, endDate: end })

    expect(result.success).toBe(true)
    expect(bodies.length).toBeGreaterThan(1)

    for (const body of bodies) {
      const span = new Date(body.endDate).getTime() - new Date(body.startDate).getTime()
      expect(span).toBeLessThanOrEqual(90 * DAY)
    }
    // Aralığın uçları korunur; pencereler arasında boşluk kalmaz (≤1 sn kaydırma).
    expect(new Date(bodies[0].startDate).getTime()).toBe(start.getTime())
    expect(new Date(bodies[bodies.length - 1].endDate).getTime()).toBe(end.getTime())
    for (let i = 1; i < bodies.length; i++) {
      const gap =
        new Date(bodies[i].startDate).getTime() - new Date(bodies[i - 1].endDate).getTime()
      expect(gap).toBeLessThanOrEqual(1000)
      expect(gap).toBeGreaterThan(0)
    }
  })

  it("90 günden kısa aralıkta tek istek atar", async () => {
    mockFetch(() => ({ succeed: true, totalCount: 0, data: [] }))

    const end = new Date("2026-08-30T12:00:00.000Z")
    const result = await provider.listIncomingInvoices({
      startDate: new Date(end.getTime() - 30 * DAY),
      endDate: end,
    })

    expect(result.success).toBe(true)
    expect(bodies).toHaveLength(1)
  })

  it("aynı fatura iki pencerede çıkarsa tekilleştirir", async () => {
    mockFetch(() => ({ succeed: true, totalCount: 1, data: [invoice("ayni-ettn")] }))

    const end = new Date("2026-08-30T12:00:00.000Z")
    const result = await provider.listIncomingInvoices({
      startDate: new Date(end.getTime() - 365 * DAY),
      endDate: end,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toHaveLength(1)
    expect(result.data[0].uuid).toBe("ayni-ettn")
  })

  it("bir pencere alınamazsa kalanı döndürür ama uyarıyı SESSİZCE yutmaz", async () => {
    mockFetch((_body, i) =>
      i === 1
        ? { succeed: false, message: "Servis geçici olarak kullanılamıyor" }
        : { succeed: true, totalCount: 1, data: [invoice(`e-${i}`)] },
    )

    const end = new Date("2026-08-30T12:00:00.000Z")
    const result = await provider.listIncomingInvoices({
      startDate: new Date(end.getTime() - 365 * DAY),
      endDate: end,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.length).toBe(bodies.length - 1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings?.[0]).toContain("Servis geçici olarak kullanılamıyor")
  })

  it("hiçbir pencereden veri gelmezse hata döner", async () => {
    mockFetch(() => ({ succeed: false, message: "90 günden fazla zaman olamaz" }))

    const end = new Date("2026-08-30T12:00:00.000Z")
    const result = await provider.listIncomingInvoices({
      startDate: new Date(end.getTime() - 365 * DAY),
      endDate: end,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain("90 günden fazla")
  })
})
