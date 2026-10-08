import fs from "node:fs/promises"
import path from "node:path"
import { Prisma } from "@prisma/client"
import sharp from "sharp"
import { prisma } from "@/lib/db/prisma"
import { normalizeDesignOptions } from "@/lib/integrations/e-invoice/template-designer"
import { normalizeReceiptTemplate } from "@/lib/fis/receipt-template"
import { decodeDataUri, normalizeStampImage } from "./stamp-image"
import { pickLogoSource, type CompanyLogo, type LogoCandidate } from "./logo"
import { findForeignDesigns } from "./template-design.server"

/**
 * Firma logosu — okuma. Kural `logo.ts`te; görsel kaşeyle aynı yoldan PNG'ye çevrilir
 * (`stamp-image.ts`: pdfmake WebP/GIF basamaz, uzun kenar sınırlanır).
 *
 * Logo okunamazsa firma logosu yok sayılır (PDF'i düşürmek daha kötü) ama SESSİZ değil:
 * sebep firmayla birlikte loglanır.
 */

type TemplateRow = LogoCandidate & { xsltName: string; hasDesign: boolean }

/**
 * Firmanın logosu; yoksa null. `docType`: faturanın belge tipi (`logoDocTypeFor`) — o
 * tipteki şablonun logosu önce gelir.
 */
export async function loadCompanyLogo(companyId: string, docType: number | null = null): Promise<CompanyLogo | null> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { parentCompanyId: true },
    })
    if (!company) return null
    const ids = company.parentCompanyId ? [companyId, company.parentCompanyId] : [companyId]

    // Yalnız künye: options JSON'u logo + kaşe gömülü (her biri 560 KB'a kadar) ve bir
    // firmada onlarca şablon olabiliyor; görsel yalnız seçilen satırdan okunur.
    const templates = await prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
      SELECT id, "companyId", "eDocumentType", "xsltName", "isActive", hidden, "updatedAt",
             options IS NOT NULL AS "hasDesign",
             COALESCE(options->>'logoDataUri', '') <> '' AS "hasLogo"
      FROM einvoice_templates
      WHERE "companyId" IN (${Prisma.join(ids)})
    `)
    // Tasarımı aynı Mysoft hesabındaki başka kayıtta duran şablon (template-design.ts).
    const foreign = await findForeignDesigns(templates, "logoDataUri")
    for (const row of templates) {
      const designId = foreign.get(row.id)
      if (designId) Object.assign(row, { hasLogo: true, designTemplateId: designId })
    }
    const receiptLogoCompanyIds = (
      await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM companies
        WHERE id IN (${Prisma.join(ids)})
          AND COALESCE("receiptTemplate"->>'logoDataUrl', '') <> ''
      `)
    ).map((r) => r.id)

    const source = pickLogoSource({
      companyId,
      parentCompanyId: company.parentCompanyId,
      templates,
      receiptLogoCompanyIds,
      docType,
    })
    if (!source) return null

    let dataUri = ""
    if (source.kind === "template") {
      const template = await prisma.eInvoiceTemplate.findUnique({
        where: { id: source.templateId },
        select: { options: true },
      })
      dataUri = normalizeDesignOptions(template?.options).logoDataUri
    } else {
      const row = await prisma.company.findUnique({
        where: { id: source.companyId },
        select: { receiptTemplate: true },
      })
      dataUri = normalizeReceiptTemplate(row?.receiptTemplate).logoDataUrl || ""
    }

    const buffer = decodeDataUri(dataUri)
    if (!buffer) {
      console.warn("[firma-logosu] logo geçersiz, firma logosu kullanılmadı", { requestedCompanyId: companyId, ...source })
      return null
    }
    const image = await normalizeStampImage(buffer, { trim: false })
    return { dataUri: image.dataUri, pixelWidth: image.width, pixelHeight: image.height }
  } catch (error) {
    console.warn("[firma-logosu] logo okunamadı, firma logosu kullanılmadı", { companyId }, error)
    return null
  }
}

/**
 * Kobipo logosu — firmanın logosu yoksa belgeye basılan yedek. Dosya `public/yatay.png`
 * (beyaz zemin sürümü); fs ile okunduğu için Vercel paketine `next.config.js >
 * outputFileTracingIncludes` ile açıkça eklenir (fontlar gibi). İlk okumadan sonra bellekte.
 */
const KOBIPO_LOGO_PATH = path.join(process.cwd(), "public", "yatay.png")
let kobipoLogo: Promise<CompanyLogo | null> | null = null

export function loadKobipoLogo(): Promise<CompanyLogo | null> {
  kobipoLogo ??= (async () => {
    try {
      const buffer = await fs.readFile(KOBIPO_LOGO_PATH)
      const meta = await sharp(buffer).metadata()
      return {
        dataUri: `data:image/png;base64,${buffer.toString("base64")}`,
        pixelWidth: meta.width ?? 1,
        pixelHeight: meta.height ?? 1,
        kobipo: true,
      }
    } catch (error) {
      console.warn("[firma-logosu] Kobipo logosu okunamadı, belge logosuz basıldı", { path: KOBIPO_LOGO_PATH }, error)
      kobipoLogo = null
      return null
    }
  })()
  return kobipoLogo
}

/** Belgenin sağ üstüne basılacak logo: firmanınki, yoksa Kobipo'nunki. */
export async function loadDocumentLogo(companyId: string, docType: number | null = null): Promise<CompanyLogo | null> {
  return (await loadCompanyLogo(companyId, docType)) ?? (await loadKobipoLogo())
}
