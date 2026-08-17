/**
 * Teklif PDF'i yerleşim testi — "kayma" artık destek talebi değil, kırmızı test.
 *
 * Belge, gerçek hayatta taşmaya yol açan içerikle üretilir (çok uzun unvan, çok
 * uzun adres, uzun vergi dairesi, çok satırlı kalem açıklaması, uzun IBAN) ve
 * ÜRETİLEN PDF'in kendi font metriğiyle ölçülür: hiçbir metin sayfa kenar
 * boşluğunu aşmamalı ve hiçbir alan sessizce kırpılmamalı.
 */
import { describe, expect, it } from "vitest"
import { renderTeklifPdf, type TeklifPdfData } from "@/lib/pdf/documents/teklif-document"
import { extractTextRuns, findOverflows, ptToMm } from "@/lib/pdf/doc/extract-text-runs"
import { PAGE, mm } from "@/lib/pdf/doc/theme"

const LONG_ADDRESS =
  "Üniversite Caddesi No:45 Kat:3 Daire:7 işte burayı biraz uzun tutmam gerekiyor pdf kontrolü için Pamukkale / Denizli"
const LONG_COMPANY = "Reypo Medya Ajansı Reklam Tanıtım Bilişim Sanayi ve Ticaret Limited Şirketi"
const LONG_NOTE = "12*45 keçe için satır açıklaması ama opsiyonel — teslim 10 iş günü, montaj dahil, kargo alıcıya ait"

function data(overrides: Partial<TeklifPdfData> = {}): TeklifPdfData {
  return {
    quoteNo: "TKF-2026-000017",
    date: new Date("2026-08-17T00:00:00Z"),
    validUntil: new Date("2026-09-17T00:00:00Z"),
    currency: "TRY",
    notes: "Fiyatlarımız 30 gün geçerlidir. " + LONG_ADDRESS,
    company: {
      name: LONG_COMPANY,
      taxNumber: "6271036106",
      taxOffice: "Pamukkale Vergi Dairesi Müdürlüğü biraz daha uzun hali",
      address: LONG_ADDRESS,
      city: "Denizli",
      phone: "05519582737",
      email: "yasin.dikdere123@gmail.com",
      website: "https://kobipo.com",
    },
    counterparty: {
      name: "Kanyon Turizm Seyahat Acenteliği Anonim Şirketi İstanbul Şubesi",
      taxNumber: "6271036106",
      taxOffice: "Beşiktaş",
      address: "Büyükdere Caddesi Kanyon AVM Kat 5 No 185 Levent",
      district: "Beşiktaş",
      city: "İstanbul",
      phone: "02121234567",
      email: "muhasebe@kanyonturizm.com.tr",
    },
    counterpartyLabel: "MÜŞTERİ BİLGİLERİ",
    lines: [
      {
        description: "12*45 keçe",
        note: LONG_NOTE,
        quantity: 1,
        unitPrice: 2692.5,
        discountAmount: 0,
        vatRate: 20,
        totalAmount: 3231,
      },
      {
        description: "Klima montaj hizmeti ve devreye alma (uzun kalem adı örneği)",
        note: null,
        quantity: 12,
        unitPrice: 1234.567891,
        discountAmount: 500,
        vatRate: 20,
        totalAmount: 17174.81,
      },
    ],
    netAmount: 17367.31,
    vatAmount: 3473.46,
    totalAmount: 20840.77,
    discountTotal: 500,
    bankAccounts: [
      {
        name: "Ziraat Bankası Ticari Hesap",
        bankName: "T.C. Ziraat Bankası A.Ş.",
        iban: "TR33 0006 1005 1978 6457 8413 26",
        currency: "TRY",
      },
    ],
    ...overrides,
  }
}

describe("Teklif PDF yerleşimi", () => {
  it("geçerli PDF üretir", async () => {
    const buf = await renderTeklifPdf(data())
    expect(buf.subarray(0, 4).toString()).toBe("%PDF")
    expect(buf.length).toBeGreaterThan(10_000)
  })

  it("hiçbir metin sayfa kenar boşluğunu aşmaz (uzun unvan/adres/açıklama ile)", async () => {
    const buf = await renderTeklifPdf(data())
    const runs = extractTextRuns(buf)
    expect(runs.length).toBeGreaterThan(20)

    const overflows = findOverflows(runs, {
      marginLeft: PAGE.paddingHorizontal,
      marginRight: PAGE.paddingHorizontal,
      tolerance: 2, // yuvarlama payı
    })
    const detail = overflows
      .map((r) => `"${r.text.slice(0, 40)}" x=${ptToMm(r.x).toFixed(1)}mm son=${ptToMm(r.x + r.width).toFixed(1)}mm`)
      .join("\n")
    expect(overflows, `sayfa dışına taşan metin:\n${detail}`).toHaveLength(0)
  })

  it("uzun alanları kırpmaz — unvan, adres ve satır açıklaması belgede tam geçer", async () => {
    const buf = await renderTeklifPdf(data())
    const text = extractTextRuns(buf)
      .map((r) => r.text)
      .join(" ")
      .replace(/\s+/g, " ")

    // Sarma kelime kelime ayrı parça üretir; boşlukları atıp arıyoruz.
    const packed = text.replace(/\s/g, "")
    for (const word of ["Şirketi", "Üniversite", "Pamukkale", "montaj", "kargo", "TR33"]) {
      expect(packed, `"${word}" belgede yok (kırpılmış olabilir)`).toContain(word.replace(/\s/g, ""))
    }
  })

  it("dip toplam değerleri sağ kenarda hizalı biter", async () => {
    const buf = await renderTeklifPdf(data())
    const runs = extractTextRuns(buf)
    const rightEdge = 595.28 - PAGE.paddingHorizontal

    // Tutarların hepsi sağ kenarda bitmeli — hizalamayı motor font ölçümüyle
    // yapıyor; elle koordinat verilen eski sürümde etiket uzayınca kayıyordu.
    // Yalnız dip toplamda geçen değerler (kalem tablosundaki tutarlarla karışmasın).
    const values = ["17.367,31", "3.473,46", "20.840,77"]
    for (const v of values) {
      const run = runs.find((r) => r.text.includes(v))
      expect(run, `${v} bulunamadı`).toBeTruthy()
      const end = run!.x + run!.width
      expect(
        Math.abs(end - rightEdge),
        `${v} sağ kenarda bitmiyor (son=${ptToMm(end).toFixed(1)}mm, kenar=${ptToMm(rightEdge).toFixed(1)}mm)`,
      ).toBeLessThan(2)
    }

    // Etiketler aynı sol kenardan başlar (toplam kutusu tek hizada).
    // NOT: motor her KELİMEYİ ayrı parça olarak yazabilir; ilk kelimeyle aranır.
    // Dip toplam tablodan SONRA çizilir; aynı kelime tablo başlığında da geçtiği
    // için (ör. "KDV") sondan aranır.
    const reversed = [...runs].reverse()
    const labels = ["Ara", "KDV", "GENEL"]
      .map((l) => reversed.find((r) => r.text.trim().startsWith(l)))
      .filter(Boolean)
    expect(labels).toHaveLength(3)
    const xs = labels.map((r) => r!.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1)
  })

  it("kalem tablosunun tutar kolonu tablo içinde kalır", async () => {
    const buf = await renderTeklifPdf(data())
    const runs = extractTextRuns(buf)
    const rightEdge = 595.28 - PAGE.paddingHorizontal

    // Tablo hücre dolgusu kadar içeride bitmeli, dışına taşmamalı.
    const amounts = runs.filter((r) => /^₺?[\d.]+,\d{2}$/.test(r.text.trim()))
    expect(amounts.length).toBeGreaterThan(2)
    for (const a of amounts) {
      expect(a.x + a.width).toBeLessThanOrEqual(rightEdge + 2)
    }
  })
})
