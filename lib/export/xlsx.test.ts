import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { buildXlsx, excelDateSerial } from "@/lib/export/xlsx"
import { formatCellText } from "@/lib/export/values"

describe("excelDateSerial", () => {
  it("Excel'in bilinen seri numaralarını verir (1899-12-30 = 0, 2026-09-19 = 46284)", () => {
    // Yerel bileşenlerle kurulur; testin çalıştığı makinenin TZ'sine bağlı kalmasın diye Date de yerel kurulur.
    expect(excelDateSerial(new Date(1899, 11, 30))).toBe(0)
    expect(excelDateSerial(new Date(2026, 8, 19))).toBe(46284)
    expect(excelDateSerial(new Date(2026, 8, 19, 12, 0, 0))).toBe(46284.5)
  })

  it("yerel duvar saatini yazar: Intl'in (PDF/CSV) bastığı saatle aynı", () => {
    const d = new Date(2026, 8, 30, 17, 45) // yerel 30.09.2026 17:45
    const serial = excelDateSerial(d)
    const gun = Math.floor(serial)
    const saat = Math.round((serial - gun) * 24 * 60) // dakika
    expect(gun).toBe(46295)
    expect(saat).toBe(17 * 60 + 45)
    expect(formatCellText(d, "datetime")).toBe("30.09.2026 17:45")
  })

  it("eski SheetJS'in 1899 LMT kayması yok: tam saatte kesir tam çıkar", () => {
    const serial = excelDateSerial(new Date(2026, 0, 1, 15, 30))
    expect(serial - Math.floor(serial)).toBeCloseTo(15.5 / 24, 10)
  })
})

describe("buildXlsx tarih hücreleri", () => {
  const dataset = {
    title: "T",
    company: { name: "X" },
    sections: [
      {
        columns: [
          { key: "tarih", label: "Tarih", type: "date" as const },
          { key: "vade", label: "Vade", type: "datetime" as const },
        ],
        rows: [{ tarih: new Date(2026, 8, 1), vade: new Date(2026, 8, 30, 17, 45) }],
      },
    ],
  }

  it("tarih hücresi seri numarasıdır (t:n), Date/ISO değil — SheetJS sürümünün TZ çevrimi devreye girmez", () => {
    const buf = buildXlsx(dataset as never)
    const wb = XLSX.read(buf, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    expect(ws.A2.t).toBe("n")
    expect(ws.A2.v).toBe(46266)
    expect(ws.B2.t).toBe("n")
    expect(ws.B2.v).toBeCloseTo(46295 + (17 * 60 + 45) / 1440, 9)
  })

  it("hücre biçimi dd.mm.yyyy / dd.mm.yyyy hh:mm olarak yazılır ve PDF/CSV metniyle aynı günü gösterir", () => {
    // SheetJS'in kendi biçim motoru (SSF) noktalı Türkçe tarih biçimini ayrıştıramaz
    // (raw:false okumada seri döner) — Excel ise bu biçimi sorunsuz basar. O yüzden
    // metin yerine seri numarası + biçim kodu doğrulanır.
    const buf = buildXlsx(dataset as never)
    const wb = XLSX.read(buf, { type: "buffer", cellNF: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    expect(ws.A2.z).toBe("dd.mm.yyyy")
    expect(ws.B2.z).toBe("dd.mm.yyyy hh:mm")
    // 46266 = 01.09.2026, 46295 = 30.09.2026: Excel'de görünecek gün, Intl'in bastığı günle aynı
    expect(ws.A2.v).toBe(46266)
    expect(formatCellText(new Date(2026, 8, 1), "date")).toBe("01.09.2026")
    expect(Math.floor(ws.B2.v as number)).toBe(46295)
    expect(formatCellText(new Date(2026, 8, 30, 17, 45), "datetime")).toBe("30.09.2026 17:45")
  })
})
