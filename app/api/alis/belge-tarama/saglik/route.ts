/**
 * Belge tarama SAĞLIK ucu — Vercel'de PDF katmanının ölçümü (plan Faz 0).
 *
 * "Yerelde çalışıyor" Vercel'de çalıştığı anlamına gelmez: `@napi-rs/canvas`
 * platform ikilisi ve pdfjs'in dinamik worker'ı fonksiyon paketine girmemiş
 * olabilir (sharp'ın `models.ts` ayrımı aynı sebeple var). Bu uç canlıda
 * çağrılır ve dört soruyu cevaplar: metin katmanı okunuyor mu, gömülü görsel
 * karekod çözülüyor mu, RASTER çalışıyor mu (vektör karekod), ek okunuyor mu.
 *
 * KAPI: belge tarama denemesine dahil bir firmanın üyesi (`?companyId=`, beyaz
 * liste — FIS_TARAMA_COMPANIES) ya da süper admin. Model çağrısı YOK, para
 * harcamaz; ekrandaki "Sistem kontrolü" düğmesi buraya gelir.
 */

import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { getCurrentUser } from "@/lib/auth/session"
import { withApiErrors } from "@/lib/api/errors"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"
import { prisma } from "@/lib/db/prisma"
import { pdfOku, pdfSayfaRaster } from "@/lib/belge-ocr/girdi/pdf"
import { karekodCoz } from "@/lib/belge-ocr/girdi/karekod"
import { ublAdaylari } from "@/lib/belge-ocr/girdi/xml-ek"

export const dynamic = "force-dynamic"
export const maxDuration = 30

const KAREKOD = JSON.stringify({ vkntckn: "1111111111", avkntckn: "2222222222", senaryo: "EARSIVFATURA", tip: "SATIS", tarih: "2026-01-01", no: "TST2026000000001", ettn: "00000000-0000-0000-0000-000000000000", parabirimi: "TRY", odenecek: 1 })
const XML = '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>TST2026000000001</ID></Invoice>'

async function pdfUret(icerik: any[], ek?: { ad: string; icerik: Buffer }): Promise<Buffer> {
  const PdfPrinter: any = (await import("pdfmake")).default
  const printer = new PdfPrinter({
    Roboto: { normal: "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", bold: "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf" },
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

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(user as { isSuperAdmin?: boolean }).isSuperAdmin) {
    const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    await ensureCompanyAccess(companyId)
    const firma = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, slug: true } })
    if (!fisTaramaAcikMi(firma)) {
      return NextResponse.json({ error: "Belge tarama bu firma için açık değil" }, { status: 403 })
    }
  }

  const sonuc: Record<string, unknown> = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    vercel: !!process.env.VERCEL,
  }
  const t0 = Date.now()
  try {
    const metin = Array.from({ length: 10 }, (_, i) => `Satır ${i + 1}: örnek metin katmanı ölçümü 1.234,56 TL`).join("\n")
    const qrPng = await QRCode.toDataURL(KAREKOD, { margin: 1, scale: 6 })
    // 1) metin + gömülü görsel karekod + ek
    const pdf1 = await pdfUret([{ text: "SAĞLIK", bold: true }, { image: qrPng, width: 80 }, { text: metin }], { ad: "test.xml", icerik: Buffer.from(XML) })
    const o1 = await pdfOku(pdf1)
    sonuc.metinKatmani = { var: o1.metinKatmaniVar, karakter: o1.metinKarakter }
    sonuc.gomuluKarekod = { yol: o1.karekodYolu, cozuldu: karekodCoz(o1.karekodHam)?.tur === "GIB" }
    sonuc.ek = { adet: o1.ekler.length, ubl: ublAdaylari(o1.ekler).length }

    // 2) vektör karekod → raster şart
    const pdf2 = await pdfUret([{ qr: KAREKOD, fit: 80 }])
    const o2 = await pdfOku(pdf2)
    sonuc.vektorKarekod = { yol: o2.karekodYolu, cozuldu: karekodCoz(o2.karekodHam)?.tur === "GIB" }

    // 3) sayfa raster (modele gidecek JPEG)
    const t1 = Date.now()
    const jpeg = await pdfSayfaRaster(pdf1, 1)
    sonuc.raster = jpeg ? { ok: true, jpegKb: Math.round(jpeg.length / 1024), ms: Date.now() - t1 } : { ok: false, sebep: "@napi-rs/canvas yüklenemedi" }
    sonuc.ok = o1.metinKatmaniVar && o1.karekodYolu === "gomulu-gorsel" && o1.ekler.length === 1 && !!jpeg && o2.karekodYolu === "raster"
  } catch (e: any) {
    sonuc.ok = false
    sonuc.hata = e?.message || String(e)
    sonuc.stack = String(e?.stack || "").split("\n").slice(0, 6)
  }
  sonuc.toplamMs = Date.now() - t0
  return NextResponse.json(sonuc, { status: sonuc.ok ? 200 : 500 })
})
