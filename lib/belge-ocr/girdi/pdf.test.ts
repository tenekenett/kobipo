/**
 * PDF girdi katmanı — Faz 0 ölçümü kod hâline getirildi (2026-09-21):
 * metin katmanı eşiği, gömülü görsel karekod, vektör karekod (raster), PDF/A-3
 * eki. PDF'ler test anında pdfmake ile üretilir; gerçek e-Arşiv korpusu
 * gelince aynı test gerçek dosyalarla genişler.
 */

import { describe, expect, it } from "vitest"
import QRCode from "qrcode"
import { karekodCoz } from "./karekod"
import { pdfOku, pdfSayfaRaster } from "./pdf"
import { ublAdaylari } from "./xml-ek"
import { ORNEK_FATURA_XML } from "../ubl.test"

const KAREKOD = JSON.stringify({ vkntckn: "7352344835", avkntckn: "3531285187", senaryo: "EARSIVFATURA", tip: "SATIS", tarih: "2026-09-21", no: "RYP2026000000123", ettn: "6f1c2a3e-1111-2222-3333-444455556666", parabirimi: "TRY", malhizmettoplam: 1050, "kdvmatrah(20)": 800, "hesaplanankdv(20)": 160, vergidahil: 1180, odenecek: 1180 })

async function pdfUret(icerik: any[], ek?: { ad: string; icerik: Buffer }): Promise<Buffer> {
  const PdfPrinter: any = (await import("pdfmake")).default
  const printer = new PdfPrinter({
    Roboto: {
      normal: "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
      bold: "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
    },
  })
  const doc: any = printer.createPdfKitDocument({ content: icerik, defaultStyle: { font: "Roboto" } })
  if (ek) doc.file(ek.icerik, { name: ek.ad, type: "text/xml" })
  const parcalar: Buffer[] = []
  doc.on("data", (c: Buffer) => parcalar.push(c))
  await new Promise<void>((r) => {
    doc.on("end", () => r())
    doc.end()
  })
  return Buffer.concat(parcalar)
}

const uzunMetin = Array.from({ length: 12 }, (_, i) => `Kalem ${i + 1}: Forklift lastiği 450,00 TL x 2 adet, KDV %20`).join("\n")

describe("pdfOku", () => {
  it("metin katmanı + gömülü görsel karekod (saf JS yolu)", async () => {
    const qr = await QRCode.toDataURL(KAREKOD, { margin: 1, scale: 6 })
    const pdf = await pdfUret([{ text: "e-ARŞİV FATURA", bold: true }, { image: qr, width: 90 }, { text: uzunMetin }])
    const o = await pdfOku(pdf)
    expect(o.sayfaSayisi).toBe(1)
    expect(o.metinKatmaniVar).toBe(true)
    expect(o.karekodYolu).toBe("gomulu-gorsel")
    const k = karekodCoz(o.karekodHam)
    expect(k?.tur).toBe("GIB")
    if (k?.tur === "GIB") expect(k.belgeNo).toBe("RYP2026000000123")
  }, 30000)

  it("vektör karekod raster yoluyla çözülür; metinsiz PDF'te katman yok", async () => {
    const pdf = await pdfUret([{ qr: KAREKOD, fit: 90 }])
    const o = await pdfOku(pdf)
    expect(o.metinKatmaniVar).toBe(false)
    // @napi-rs/canvas yerelde kurulu: raster beklenir. Kurulamayan ortamda
    // "raster-yok" döner — o zaman bu satır Vercel ölçümünün cevabıdır.
    expect(["raster", "raster-yok"]).toContain(o.karekodYolu)
    if (o.karekodYolu === "raster") expect(karekodCoz(o.karekodHam)?.tur).toBe("GIB")
    const jpeg = await pdfSayfaRaster(pdf, 1)
    if (jpeg) expect(jpeg.length).toBeGreaterThan(1000)
  }, 30000)

  it("PDF/A-3 eki UBL adayı olarak çıkar", async () => {
    const pdf = await pdfUret([{ text: "Ekli fatura" }], { ad: "RYP2026000000123.xml", icerik: Buffer.from(ORNEK_FATURA_XML, "utf8") })
    const o = await pdfOku(pdf)
    expect(o.ekler.map((e) => e.ad)).toEqual(["RYP2026000000123.xml"])
    const adaylar = ublAdaylari(o.ekler)
    expect(adaylar).toHaveLength(1)
    expect(adaylar[0].tur).toBe("INVOICE")
  }, 30000)
})
