import { XMLParser } from "fast-xml-parser"

/**
 * TCMB günlük döviz kuru servisi.
 * Kaynak: https://www.tcmb.gov.tr/kurlar/today.xml (hafta içi ~15:30 güncellenir).
 * Döviz SATIŞ (ForexSelling) kuru kullanılır — ürün fiyatını TL'ye çevirmek için standart.
 * Sonuç modül düzeyinde 2 saat cache'lenir (serverless instance başına).
 */

export type ExchangeRates = {
  USD: number
  EUR: number
  date: string
  source: "TCMB"
}

let cache: { rates: ExchangeRates; fetchedAt: number } | null = null
const TTL_MS = 2 * 60 * 60 * 1000 // 2 saat

export async function getTcmbRates(): Promise<ExchangeRates> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.rates

  const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "Kobipo/1.0" },
    // TCMB verisi gün içinde değişmez; Next fetch cache'ini de 2 saat tut.
    next: { revalidate: 7200 },
  })
  if (!res.ok) throw new Error(`TCMB kur servisine ulaşılamadı (HTTP ${res.status})`)

  const xml = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
  const doc = parser.parse(xml)
  const list: any[] = Array.isArray(doc?.Tarih_Date?.Currency) ? doc.Tarih_Date.Currency : []

  const pick = (kod: string): number => {
    const c = list.find((x) => x?.["@_Kod"] === kod || x?.["@_CurrencyCode"] === kod)
    if (!c) return 0
    const unit = Number(c?.Unit) || 1
    const raw = String(c?.ForexSelling ?? "").replace(",", ".")
    const sell = Number(raw) || 0
    return unit > 0 ? sell / unit : sell
  }

  const USD = pick("USD")
  const EUR = pick("EUR")
  if (!USD || !EUR) throw new Error("TCMB yanıtında USD/EUR kuru bulunamadı.")

  const date = String(doc?.Tarih_Date?.["@_Tarih"] || doc?.Tarih_Date?.["@_Date"] || "")
  const rates: ExchangeRates = { USD, EUR, date, source: "TCMB" }
  cache = { rates, fetchedAt: Date.now() }
  return rates
}
