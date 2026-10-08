import { Prisma } from "@prisma/client"
import sharp from "sharp"
import { prisma } from "@/lib/db/prisma"
import { normalizeDesignOptions } from "@/lib/integrations/e-invoice/template-designer"
import { MAX_STAMP_UPLOAD_CHARS, StampImageError, decodeDataUri, normalizeStampImage } from "./stamp-image"
import { findForeignDesigns } from "./template-design.server"
import {
  clampStampWidthMm,
  pickStampSource,
  settingsStampBox,
  templateStampBox,
  type CompanyStamp,
  type StampCandidate,
  type StampSource,
} from "./stamp"

/**
 * Firma kaşesi — okuma (makbuz), ayarlardan yazma ve şablondan alma. Kural `stamp.ts`te,
 * görsel hazırlığı `stamp-image.ts`te.
 *
 * Kaşe okunamazsa makbuz kaşesiz basılır (makbuzu düşürmek daha kötü) ama SESSİZ
 * değil: sebep firmayla birlikte loglanır.
 */
export { StampImageError } from "./stamp-image"

type TemplateRow = StampCandidate & { eDocumentType: number; xsltName: string; hasDesign: boolean }

/**
 * Firmanın (şubede ana firmanın da) tasarımsız şablon satırları ve kaşeli tasarımlarının
 * aynı Mysoft hesabındaki karşılığı — "Şablondan al" listesi ve kopyalama denetimi için.
 */
async function foreignStampTemplates(ids: string[]) {
  const rows = await prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
    SELECT id, "companyId", "eDocumentType", "xsltName", "isActive", hidden, "updatedAt",
           false AS "hasDesign", false AS "hasStamp"
    FROM einvoice_templates
    WHERE "companyId" IN (${Prisma.join(ids)}) AND options IS NULL AND hidden = false
  `)
  const foreign = await findForeignDesigns(rows, "stampDataUri")
  return rows.flatMap((r) => {
    const designId = foreign.get(r.id)
    return designId ? [{ ...r, designTemplateId: designId }] : []
  })
}

type StampContext = {
  parentCompanyId: string | null
  settingsCompanyIds: string[]
  templates: StampCandidate[]
}

async function stampContext(companyId: string): Promise<StampContext | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true },
  })
  if (!company) return null
  const ids = company.parentCompanyId ? [companyId, company.parentCompanyId] : [companyId]

  // Ayar kaşesi okunamazsa (ör. 20261002000001_company_stamps.sql henüz uygulanmadı)
  // şablon kaşesine düşülür — tümden kaşesiz basmak, var olan kaşeyi de kaybettirirdi.
  const settingsCompanyIds = await prisma.companyStamp
    .findMany({ where: { companyId: { in: ids } }, select: { companyId: true } })
    .then((rows) => rows.map((r) => r.companyId))
    .catch((error) => {
      console.warn(
        "[firma-kasesi] ayar kaşesi okunamadı, şablon kaşesine düşüldü " +
          "(20261002000001_company_stamps.sql uygulandı mı?)",
        { companyId },
        error,
      )
      return [] as string[]
    })

  // Yalnız künye: options JSON'u logo + kaşe gömülü (her biri 560 KB'a kadar) ve bir
  // firmada onlarca şablon olabiliyor; görsel yalnız seçilen satırdan okunur.
  const templates = await prisma.$queryRaw<TemplateRow[]>(Prisma.sql`
    SELECT id, "companyId", "eDocumentType", "xsltName", "isActive", hidden, "updatedAt",
           options IS NOT NULL AS "hasDesign",
           COALESCE(options->>'stampDataUri', '') <> '' AS "hasStamp"
    FROM einvoice_templates
    WHERE "companyId" IN (${Prisma.join(ids)})
  `)
  // Tasarımı aynı Mysoft hesabındaki başka kayıtta duran şablon (template-design.ts).
  const foreign = await findForeignDesigns(templates, "stampDataUri")
  for (const row of templates) {
    const designId = foreign.get(row.id)
    if (designId) Object.assign(row, { hasStamp: true, designTemplateId: designId })
  }
  return { parentCompanyId: company.parentCompanyId, settingsCompanyIds, templates }
}

export async function resolveStampSource(companyId: string): Promise<StampSource | null> {
  const ctx = await stampContext(companyId)
  return ctx ? pickStampSource({ companyId, ...ctx }) : null
}

/** Makbuza basılacak kaşe; yoksa ya da okunamazsa null (sebep loglanır). */
export async function loadCompanyStamp(companyId: string): Promise<CompanyStamp | null> {
  try {
    const source = await resolveStampSource(companyId)
    if (!source) return null

    if (source.kind === "settings") {
      const row = await prisma.companyStamp.findUnique({
        where: { companyId: source.companyId },
        select: { dataUri: true, widthMm: true },
      })
      const buffer = row ? decodeDataUri(row.dataUri) : null
      if (!row || !buffer) {
        console.warn("[firma-kasesi] ayar kaşesi geçersiz, makbuz kaşesiz basıldı", source)
        return null
      }
      // Kayıtta zaten normalleştirilmiş PNG durur; yalnız ölçüsü okunur.
      const meta = await sharp(buffer).metadata()
      return {
        dataUri: row.dataUri,
        pixelWidth: meta.width ?? 1,
        pixelHeight: meta.height ?? 1,
        ...settingsStampBox(row.widthMm),
      }
    }

    const template = await prisma.eInvoiceTemplate.findUnique({
      where: { id: source.templateId },
      select: { options: true },
    })
    const opts = normalizeDesignOptions(template?.options)
    const buffer = decodeDataUri(opts.stampDataUri)
    if (!buffer) {
      console.warn("[firma-kasesi] şablonun kaşesi geçersiz, makbuz kaşesiz basıldı", { requestedCompanyId: companyId, ...source })
      return null
    }
    const image = await normalizeStampImage(buffer, { trim: false })
    return {
      dataUri: image.dataUri,
      pixelWidth: image.width,
      pixelHeight: image.height,
      ...templateStampBox(opts.stampWidth, opts.stampHeight),
    }
  } catch (error) {
    console.warn("[firma-kasesi] kaşe okunamadı, makbuz kaşesiz basıldı", { companyId }, error)
    return null
  }
}

export type TemplateStampOption = {
  templateId: string
  /** Kaşe ana firmanın şablonundan mı geliyor (yalnız şubede). */
  fromParent: boolean
  xsltName: string
  eDocumentType: number
  isActive: boolean
  dataUri: string
}

/**
 * Ayarlar ekranının "Şablondan al" listesi: firmanın (şubede ana firmanın da) gizli
 * olmayan şablonlarındaki kaşeler — tasarımı aynı Mysoft hesabındaki başka kayıtta
 * duranlar dahil (`template-design.ts`). Aynı görsel birden çok şablonda durabildiği için
 * içerikten tekilleştirilir; aktif ve yeni olan önce gelir.
 */
export async function listTemplateStamps(companyId: string): Promise<TemplateStampOption[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true },
  })
  if (!company) return []
  const ids = company.parentCompanyId ? [companyId, company.parentCompanyId] : [companyId]
  const own = await prisma.$queryRaw<
    Array<{ id: string; companyId: string; xsltName: string; eDocumentType: number; isActive: boolean; updatedAt: Date; stamp: string }>
  >(Prisma.sql`
    SELECT id, "companyId", "xsltName", "eDocumentType", "isActive", "updatedAt", options->>'stampDataUri' AS stamp
    FROM einvoice_templates
    WHERE "companyId" IN (${Prisma.join(ids)})
      AND hidden = false
      AND COALESCE(options->>'stampDataUri', '') <> ''
  `)
  // Firmanın listesinde görünen ama tasarımı aynı Mysoft hesabındaki başka kayıtta duran
  // şablonlar: kaşe o kayıttaki tasarımdan, ad/aktiflik firmanın kendi satırından.
  const foreignRows = await foreignStampTemplates(ids)
  const foreignStamps = new Map<string, string>()
  if (foreignRows.length) {
    const designs = await prisma.$queryRaw<Array<{ id: string; stamp: string }>>(Prisma.sql`
      SELECT id, options->>'stampDataUri' AS stamp FROM einvoice_templates
      WHERE id IN (${Prisma.join([...new Set(foreignRows.map((r) => r.designTemplateId))])})
    `)
    for (const d of designs) foreignStamps.set(d.id, d.stamp)
  }

  const entries = [
    ...own.map((r) => ({ ...r, templateId: r.id })),
    ...foreignRows.map((r) => ({
      ...r,
      templateId: r.designTemplateId,
      stamp: foreignStamps.get(r.designTemplateId) || "",
    })),
  ].sort(
    (a, b) =>
      Number(b.companyId === companyId) - Number(a.companyId === companyId) ||
      Number(b.isActive) - Number(a.isActive) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      a.id.localeCompare(b.id),
  )
  const seen = new Set<string>()
  const options: TemplateStampOption[] = []
  for (const row of entries) {
    const dataUri = normalizeDesignOptions({ stampDataUri: row.stamp }).stampDataUri
    if (!dataUri || seen.has(dataUri)) continue
    seen.add(dataUri)
    options.push({
      templateId: row.templateId,
      fromParent: row.companyId !== companyId,
      xsltName: row.xsltName,
      eDocumentType: row.eDocumentType,
      isActive: row.isActive,
      dataUri,
    })
  }
  return options
}

/** Bilgisayardan yüklenen kaşeyi ayarlara yazar. */
export async function saveUploadedStamp(companyId: string, dataUri: unknown, widthMm: unknown) {
  if (typeof dataUri !== "string" || dataUri.length > MAX_STAMP_UPLOAD_CHARS) {
    throw new StampImageError("Kaşe görseli en çok 3 MB olabilir.")
  }
  const buffer = decodeDataUri(dataUri)
  if (!buffer) throw new StampImageError("Kaşe görseli okunamadı.")
  const image = await normalizeStampImage(buffer, { trim: true }).catch((error) => {
    if (error instanceof StampImageError) throw error
    throw new StampImageError("Kaşe görseli okunamadı.")
  })
  return writeSettingsStamp(companyId, image.dataUri, widthMm)
}

/**
 * Şablondaki kaşeyi ayarlara kopyalar. Şablon bu firmanın ya da (şubede) ana
 * firmanın olmalı, ya da onların şablonunun aynı Mysoft hesabındaki tasarımı — id
 * istemciden geliyor, başka firmanın kaşesi alınamasın.
 */
export async function copyTemplateStamp(companyId: string, templateId: unknown, widthMm: unknown) {
  if (typeof templateId !== "string" || !templateId) throw new StampImageError("Şablon seçilmedi.")
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true },
  })
  const template = await prisma.eInvoiceTemplate.findUnique({
    where: { id: templateId },
    select: { companyId: true, hidden: true, options: true },
  })
  const allowed = [companyId, company?.parentCompanyId].filter((id): id is string => Boolean(id))
  const ownTemplate = Boolean(template && !template.hidden && allowed.includes(template.companyId))
  // Tasarımı aynı Mysoft hesabındaki başka kayıtta duran şablon: listeyle aynı kural.
  const foreignDesign =
    Boolean(template) &&
    !ownTemplate &&
    (await foreignStampTemplates(allowed)).some((r) => r.designTemplateId === templateId)
  if (!template || (!ownTemplate && !foreignDesign)) {
    throw new StampImageError("Şablon bulunamadı.")
  }
  const buffer = decodeDataUri(normalizeDesignOptions(template.options).stampDataUri)
  if (!buffer) throw new StampImageError("Bu şablonda kaşe yok.")
  const image = await normalizeStampImage(buffer, { trim: true })
  return writeSettingsStamp(companyId, image.dataUri, widthMm)
}

async function writeSettingsStamp(companyId: string, dataUri: string, widthMm: unknown) {
  const width = clampStampWidthMm(widthMm)
  return prisma.companyStamp.upsert({
    where: { companyId },
    create: { companyId, dataUri, widthMm: width },
    update: { dataUri, widthMm: width },
    select: { dataUri: true, widthMm: true, updatedAt: true },
  })
}
