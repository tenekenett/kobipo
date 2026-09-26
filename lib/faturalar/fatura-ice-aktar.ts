/**
 * Fatura İÇE AKTARMA — veritabanı tarafı (alış, satış, ihracat).
 *
 * Dosyanın biçim kuralları `lib/faturalar/fatura-sablon.ts`te (saf); burası
 * dosyanın veritabanıyla buluştuğu yer: cari (tedarikçi/müşteri) ve ürün eşleşmesi,
 * mükerrer fatura denetimi, vade önerisi ve yazma.
 *
 * YAZMA TEK YOLDAN: her fatura `createInvoiceFromBody` ile açılır — fatura
 * editörünün "Kaydet"inin çağırdığı çekirdek. Dip toplam, stok hareketi, otomatik
 * muhasebe fişi, aylık fatura kotası ve numara tekilliği oradan gelir. Burada
 * `prisma.invoice.create` YAZILMAZ: ikinci bir fatura yolu, editörde düzeltilen her
 * kuralı (ör. kuruş yuvarlaması) bir gün sessizce kaçırırdı.
 *
 * SATIŞ/İHRACAT ONAYLI KAYDEDİLİR: içe aktarılan satış faturası başka bir yerde
 * zaten kesilmiş bir belgedir. Taslak kalsaydı yaşlandırmaya girmez, otomasyon
 * kartı "taslakta kalmış fatura" diye sayardı. Durum, MANUAL faturanın "Onayla"
 * ucuyla (`/api/e-donusum/invoices/[id]/approve`) aynı geçişle SENT yapılır; belge
 * GİB'e GÖNDERİLMEZ (invoiceType MANUAL). Alış zaten "Kayıtlı" sunulan DRAFT'ta kalır.
 *
 * İstemci içe aktarmayı PARÇA PARÇA ister (bkz. `keys`): dosya her istekte yeniden
 * okunur ve baştan hazırlanır. Böylece bir önceki parçada açılan cari sonraki
 * parçada "mevcut" olarak eşleşir, zaten yazılmış fatura "kayıtlı" diye durur —
 * istek süresi fatura sayısıyla büyümez.
 */

import { prisma } from "@/lib/db/prisma"
import { trEqualsIds } from "@/lib/db/tr-search"
import { trFold } from "@/lib/text/tr-fold"
import {
  isCariVisible,
  resolveAuthorizedUserIdOnWrite,
  type CariVisibility,
} from "@/lib/cari/visibility"
import { vadeTarihiTuret } from "@/lib/cari/vade"
import { createInvoiceFromBody } from "@/lib/invoice/create-invoice"
import type { WriteActor } from "@/lib/api/write-actor"
import {
  ISTISNA_GEREKCELERI,
  canonicalTaxNumber,
  cariEtiketi,
  expectedTotalMismatch,
  faturaSablonToplami,
  type SablonFaturasi,
  type SablonToplami,
  type SablonTuru,
} from "@/lib/faturalar/fatura-sablon"

export type ImportCounterparty =
  | { kind: "existing"; id: string; name: string; taxNumber: string | null }
  | {
      kind: "new"
      /** Aynı dosyada aynı yeni cariyi paylaşan faturalar tek kart açar. */
      newKey: string
      name: string
      taxNumber: string | null
      country: string | null
    }

export type ImportLine = {
  row: number
  productId: string | null
  productCode: string
  description: string
  unit: string
  quantity: number
  unitPrice: number
  discountMode: "PERCENT" | "AMOUNT"
  discountRate: number
  discountAmount: number
  vatRate: number
  exemptionCode: string
}

export type ImportPlan = {
  key: string
  rows: number[]
  invoiceNo: string
  date: string | null
  dueDate: string | null
  /** Vade nereden geldi: dosyadan, cari kartının ödeme vadesinden ya da hiç. */
  dueDateSource: "dosya" | "kart" | null
  counterparty: ImportCounterparty | null
  currency: string
  exchangeRate: number | null
  category: string
  notes: string
  globalDiscount: number
  lines: ImportLine[]
  totals: SablonToplami | null
  errors: string[]
  warnings: string[]
}

export type ImportContext = {
  tur: SablonTuru
  visibility: CariVisibility
  /** Oturumdaki kullanıcı yeni cari kartı açabilir mi (Tedarikçi / Müşteri sayfası yazması). */
  canCreateCounterparty: boolean
}

type CariRow = {
  id: string
  name: string
  taxNumber: string | null
  paymentDueDays: number | null
  archivedAt: Date | null
  authorizedUserId: string | null
}

type ProductRow = { id: string; code: string | null; name: string; unit: string; isActive: boolean }

/** Id listesini parçalar — bind parametre sınırına çarpmamak için. */
function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const CARI_SELECT = {
  id: true,
  name: true,
  taxNumber: true,
  paymentDueDays: true,
  archivedAt: true,
  authorizedUserId: true,
} as const

async function findCari(
  table: "suppliers" | "customers",
  companyId: string,
  where: Record<string, unknown>,
): Promise<CariRow[]> {
  // İki model bu alanlarda birebir aynı; birleşim tipi çağrı imzalarını
  // eşleştiremediği için tek tipe daraltılıyor (lib/import/apply.ts ile aynı yol).
  const model = (table === "suppliers" ? prisma.supplier : prisma.customer) as typeof prisma.supplier
  return model.findMany({ where: { companyId, ...where }, select: CARI_SELECT })
}

async function loadCounterparties(
  companyId: string,
  tur: SablonTuru,
  invoices: SablonFaturasi[],
): Promise<CariRow[]> {
  const table = tur === "alis" ? "suppliers" : "customers"
  const taxNumbers = Array.from(new Set(invoices.map((i) => i.counterpartyTaxNumber).filter(Boolean)))
  const names = Array.from(new Set(invoices.map((i) => i.counterpartyName).filter(Boolean)))

  const byId = new Map<string, CariRow>()
  for (const part of chunks(taxNumbers, 500)) {
    for (const row of await findCari(table, companyId, { taxNumber: { in: part } })) byId.set(row.id, row)
  }
  // Vergi no ve ünvan eşleşmesi Türkçe duyarsız: "IŞIK GIDA" satırı "Işık Gıda"
  // kartını bulur (lib/text/tr-fold.ts). Aday havuzu SQL'de katlanır, seçim aşağıda.
  for (const part of chunks(names, 200)) {
    const ids = await trEqualsIds({
      table,
      companyId,
      matches: part.map((name) => ({ column: "name", value: name })),
    })
    if (!ids || ids.length === 0) continue
    for (const row of await findCari(table, companyId, { id: { in: ids } })) byId.set(row.id, row)
  }
  return Array.from(byId.values())
}

async function loadProducts(companyId: string, invoices: SablonFaturasi[]): Promise<ProductRow[]> {
  const codes = Array.from(
    new Set(invoices.flatMap((i) => i.lines.map((l) => l.productCode)).filter(Boolean)),
  )
  const out: ProductRow[] = []
  for (const part of chunks(codes, 200)) {
    const ids = await trEqualsIds({
      table: "products",
      companyId,
      matches: part.map((code) => ({ column: "code", value: code })),
    })
    if (!ids || ids.length === 0) continue
    out.push(
      ...(await prisma.product.findMany({
        where: { companyId, id: { in: ids } },
        select: { id: true, code: true, name: true, unit: true, isActive: true },
      })),
    )
  }
  return out
}

/**
 * Cari eşleşmesi. Sıra: vergi no → ünvan. Belirsizlikte KARAR VERİLMEZ, fatura
 * hataya düşer: yanlış karta yazılan fatura cari bakiyesini sessizce bozar, fark
 * ancak ekstre mutabakatında görülürdü.
 */
function resolveCounterparty(
  invoice: SablonFaturasi,
  candidates: CariRow[],
  ctx: ImportContext,
  errors: string[],
  warnings: string[],
): { counterparty: ImportCounterparty | null; paymentDueDays: number | null } {
  const cari = cariEtiketi(ctx.tur)
  const cariLower = cari.toLocaleLowerCase("tr-TR")
  const fail = (message: string) => {
    errors.push(message)
    return { counterparty: null, paymentDueDays: null }
  }
  const vkn = invoice.counterpartyTaxNumber
  const foldedName = trFold(invoice.counterpartyName)
  const byName = foldedName ? candidates.filter((s) => trFold(s.name) === foldedName) : []

  let match: CariRow | null = null
  if (vkn) {
    const byVkn = candidates.filter((s) => canonicalTaxNumber(s.taxNumber) === vkn)
    if (byVkn.length === 1) {
      match = byVkn[0]
      if (foldedName && trFold(match.name) !== foldedName) {
        warnings.push(`Vergi no ${vkn} ile "${match.name}" kartına bağlandı (dosyada "${invoice.counterpartyName}" yazıyor).`)
      }
    } else if (byVkn.length > 1) {
      const narrowed = byVkn.filter((s) => trFold(s.name) === foldedName)
      if (narrowed.length === 1) match = narrowed[0]
      else {
        return fail(
          `Vergi no ${vkn} birden fazla ${cariLower} kartında kayıtlı (${byVkn
            .map((s) => s.name)
            .join(", ")}); hangisine yazılacağı belirsiz.`,
        )
      }
    } else if (byName.length > 0) {
      const withoutVkn = byName.filter((s) => !canonicalTaxNumber(s.taxNumber))
      const otherVkn = byName.filter((s) => canonicalTaxNumber(s.taxNumber))
      if (withoutVkn.length === 1 && otherVkn.length === 0) {
        match = withoutVkn[0]
        warnings.push(
          `"${match.name}" kartında vergi no yok; ünvanla eşleşti. Dosyadaki numara (${vkn}) karta yazılmadı.`,
        )
      } else if (otherVkn.length > 0) {
        return fail(
          `"${invoice.counterpartyName}" ünvanlı ${cariLower} kayıtlı ama vergi no'su farklı ` +
            `(${otherVkn.map((s) => s.taxNumber).join(", ")} ≠ ${vkn}).`,
        )
      } else {
        return fail(`"${invoice.counterpartyName}" ünvanıyla birden fazla ${cariLower} kayıtlı; hangisine yazılacağı belirsiz.`)
      }
    }
  } else if (byName.length === 1) {
    match = byName[0]
  } else if (byName.length > 1) {
    return fail(
      `"${invoice.counterpartyName}" ünvanıyla birden fazla ${cariLower} kayıtlı; ayırmak için vergi no sütununu doldurun.`,
    )
  }

  if (match) {
    if (match.archivedAt) return fail(`${cari} kartı arşivde: "${match.name}". Önce kartı arşivden çıkarın.`)
    // Cari görünürlüğü (lib/cari/visibility.ts): kısıtlı çalışan yalnız kendisine
    // atanmış cariye fatura girebilir — editörün seçicisinde de yalnız onlar var.
    if (!isCariVisible(match, ctx.visibility)) {
      return fail(`"${match.name}" ${cariLower} kartı size atanmamış; bu cariye fatura giremezsiniz.`)
    }
    return {
      counterparty: { kind: "existing", id: match.id, name: match.name, taxNumber: match.taxNumber },
      paymentDueDays: match.paymentDueDays,
    }
  }

  if (!invoice.counterpartyName) {
    return fail(`Vergi no ${vkn} ile kayıtlı ${cariLower} yok; yeni kart açmak için ${cari} ünvanını da yazın.`)
  }
  if (!ctx.canCreateCounterparty) {
    return fail(`"${invoice.counterpartyName}" kayıtlı bir ${cariLower} değil ve ${cariLower} kartı açma yetkiniz yok.`)
  }
  // İhracatta yeni müşterinin ülkesi zorunlu: kart TR varsayılanıyla açılırsa yabancı
  // alıcı yurt içi müşteri görünür ve bir sonraki e-belgede VKN beklenir.
  if (ctx.tur === "ihracat" && !invoice.country) {
    return fail(`"${invoice.counterpartyName}" yeni müşteri kartı olarak açılacak; ihracatta Ülke sütunu zorunlu.`)
  }
  return {
    counterparty: {
      kind: "new",
      newKey: vkn || `ad:${foldedName}`,
      name: invoice.counterpartyName,
      taxNumber: vkn || null,
      country: invoice.country || null,
    },
    paymentDueDays: null,
  }
}

/**
 * Dosyadaki faturaları yazılabilir plana çevirir. Hiçbir şey YAZMAZ; önizleme
 * ve içe aktarma aynı planı kullanır ki önizlemede "hazır" görünen fatura yazılırken
 * başka bir kurala takılmasın.
 */
export async function prepareFaturaImport(
  companyId: string,
  invoices: SablonFaturasi[],
  ctx: ImportContext,
): Promise<ImportPlan[]> {
  const valid = invoices.filter((i) => i.errors.length === 0)
  const [counterparties, products] = await Promise.all([
    loadCounterparties(companyId, ctx.tur, valid),
    loadProducts(companyId, valid),
  ])

  const productsByCode = new Map<string, ProductRow[]>()
  for (const product of products) {
    const key = trFold(product.code)
    if (!key) continue
    productsByCode.set(key, [...(productsByCode.get(key) ?? []), product])
  }

  const plans: ImportPlan[] = invoices.map((invoice) => {
    const errors = [...invoice.errors]
    const warnings: string[] = []
    const base: ImportPlan = {
      key: invoice.key,
      rows: invoice.rows,
      invoiceNo: invoice.invoiceNo,
      date: invoice.date,
      dueDate: invoice.dueDate,
      dueDateSource: invoice.dueDate ? "dosya" : null,
      counterparty: null,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      category: invoice.category,
      notes: invoice.notes,
      globalDiscount: invoice.globalDiscount,
      lines: [],
      totals: null,
      errors,
      warnings,
    }
    if (errors.length > 0) return base

    const { counterparty, paymentDueDays } = resolveCounterparty(invoice, counterparties, ctx, errors, warnings)
    base.counterparty = counterparty

    // Vade: dosyada yoksa editörle AYNI öneri — kartın ödeme vadesi. Kartta vade
    // yoksa boş kalır ("bilmiyorsan uydurma", lib/cari/vade.ts). Önizlemede yazar.
    if (!base.dueDate && invoice.date && paymentDueDays) {
      const derived = vadeTarihiTuret(invoice.date, paymentDueDays)
      if (derived) {
        base.dueDate = derived
        base.dueDateSource = "kart"
      }
    }

    for (const line of invoice.lines) {
      let productId: string | null = null
      let description = line.description
      let unit = line.unit
      if (line.productCode) {
        const hits = productsByCode.get(trFold(line.productCode)) ?? []
        if (hits.length === 0) {
          errors.push(`Satır ${line.row}: "${line.productCode}" kodlu ürün/hizmet kartı bulunamadı.`)
          continue
        }
        if (hits.length > 1) {
          errors.push(`Satır ${line.row}: "${line.productCode}" kodu birden fazla kartta kayıtlı (${hits.map((h) => h.name).join(", ")}).`)
          continue
        }
        const product = hits[0]
        if (!product.isActive) {
          errors.push(`Satır ${line.row}: "${product.name}" kartı pasif.`)
          continue
        }
        productId = product.id
        if (!description) description = product.name
        if (!unit) unit = product.unit
      }
      base.lines.push({
        row: line.row,
        productId,
        productCode: line.productCode,
        description,
        unit: unit || "ADET",
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountMode: line.discountMode,
        discountRate: line.discountRate,
        discountAmount: line.discountAmount,
        vatRate: line.vatRate,
        exemptionCode: line.exemptionCode,
      })
    }

    base.totals = faturaSablonToplami(invoice)
    const mismatch = expectedTotalMismatch(invoice, base.totals.total)
    if (mismatch) errors.push(mismatch)
    return base
  })

  await markDuplicates(companyId, plans, ctx.tur)
  return plans
}

/**
 * Numara tekilliği — veritabanı indeksleriyle AYNI kapsam (migrasyon
 * 20260921000003): alışta (tedarikçi, numara), satışta (firma, numara) ve satış
 * tarafında GİB belge numarası da (`eDocumentNo`) sayılır — e-Fatura olarak
 * kesilmiş bir faturanın iç numarası SAT-… iken dosyada GİB numarası gelir. İndeks
 * zaten reddederdi; burada söylemek hatayı önizlemeye taşır.
 */
async function markDuplicates(companyId: string, plans: ImportPlan[], tur: SablonTuru) {
  const ready = plans.filter((p) => p.errors.length === 0 && p.counterparty)
  const invoiceNos = Array.from(new Set(ready.map((p) => p.invoiceNo).filter(Boolean)))
  const taken = new Set<string>()

  if (tur === "alis") {
    const supplierIds = Array.from(
      new Set(ready.flatMap((p) => (p.counterparty?.kind === "existing" ? [p.counterparty.id] : []))),
    )
    if (supplierIds.length > 0) {
      for (const part of chunks(invoiceNos, 500)) {
        const rows = await prisma.invoice.findMany({
          where: { companyId, type: "PURCHASE", supplierId: { in: supplierIds }, invoiceNo: { in: part } },
          select: { supplierId: true, invoiceNo: true },
        })
        for (const row of rows) taken.add(`${row.supplierId}|${row.invoiceNo}`)
      }
    }
  } else {
    for (const part of chunks(invoiceNos, 500)) {
      const rows = await prisma.invoice.findMany({
        where: {
          companyId,
          type: { not: "PURCHASE" },
          OR: [{ invoiceNo: { in: part } }, { eDocumentNo: { in: part } }],
        },
        select: { invoiceNo: true, eDocumentNo: true },
      })
      for (const row of rows) {
        taken.add(row.invoiceNo)
        if (row.eDocumentNo) taken.add(row.eDocumentNo)
      }
    }
  }

  const seen = new Map<string, ImportPlan>()
  for (const plan of ready) {
    const cp = plan.counterparty as ImportCounterparty
    const cpKey = cp.kind === "existing" ? cp.id : `yeni:${cp.newKey}`
    const pair = tur === "alis" ? `${cpKey}|${plan.invoiceNo}` : plan.invoiceNo
    const inDb = tur === "alis" ? cp.kind === "existing" && taken.has(`${cp.id}|${plan.invoiceNo}`) : taken.has(plan.invoiceNo)
    if (inDb) {
      plan.errors.push(
        tur === "alis"
          ? `"${cp.name}" tedarikçisinin ${plan.invoiceNo} numaralı faturası zaten kayıtlı.`
          : `${plan.invoiceNo} numaralı fatura bu firmada zaten kayıtlı.`,
      )
      continue
    }
    const first = seen.get(pair)
    if (first) {
      plan.errors.push(
        `Aynı fatura dosyada iki kez var (satır ${first.rows[0]} ve ${plan.rows[0]}); tek grupta birleştirin.`,
      )
      continue
    }
    seen.set(pair, plan)
  }
}

export type ImportResult = {
  key: string
  invoiceNo: string
  ok: boolean
  invoiceId?: string
  invoiceSlug?: string | null
  error?: string
  /** Fatura yazıldı ama bir yan adım tamamlanmadı (stok, onay). */
  warning?: string
  /** Bu fatura için yeni cari kartı açıldıysa adı. */
  createdCounterparty?: string
}

/** Satış içe aktarımında faturaya eklenen etiket — ihracat kayıtları süzülebilsin. */
export const IHRACAT_ETIKETI = "İhracat"

/**
 * Hatasız planları yazar. Sırayla çalışır, paralel DEĞİL: aynı ürünün stok
 * hareketleri ve maliyet ortalaması eşzamanlı yazılırsa birbirini ezebilirdi.
 */
export async function runFaturaImport(
  companyId: string,
  plans: ImportPlan[],
  actor: WriteActor,
  ctx: ImportContext,
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  const createdCounterparties = new Map<string, string>()
  const isPurchase = ctx.tur === "alis"

  for (const plan of plans) {
    if (plan.errors.length > 0 || !plan.counterparty || !plan.date) {
      results.push({ key: plan.key, invoiceNo: plan.invoiceNo, ok: false, error: plan.errors[0] || "Fatura hazır değil." })
      continue
    }

    let counterpartyId: string
    let createdCounterparty: string | undefined
    try {
      if (plan.counterparty.kind === "existing") {
        counterpartyId = plan.counterparty.id
      } else {
        const known = createdCounterparties.get(plan.counterparty.newKey)
        if (known) {
          counterpartyId = known
        } else {
          // Kısıtlı çalışanın açtığı kart kendisine atanır; aksi halde kart doğar
          // doğmaz listesinden düşer (lib/cari/visibility.ts).
          const authorizedUserId = resolveAuthorizedUserIdOnWrite(null, ctx.visibility)
          const created = isPurchase
            ? await prisma.supplier.create({
                data: {
                  companyId,
                  name: plan.counterparty.name,
                  taxNumber: plan.counterparty.taxNumber,
                  authorizedUserId,
                },
                select: { id: true },
              })
            : await prisma.customer.create({
                data: {
                  companyId,
                  name: plan.counterparty.name,
                  taxNumber: plan.counterparty.taxNumber,
                  ...(plan.counterparty.country ? { country: plan.counterparty.country } : {}),
                  authorizedUserId,
                },
                select: { id: true },
              })
          counterpartyId = created.id
          createdCounterparties.set(plan.counterparty.newKey, created.id)
          createdCounterparty = plan.counterparty.name
        }
      }
    } catch (error: any) {
      results.push({
        key: plan.key,
        invoiceNo: plan.invoiceNo,
        ok: false,
        error: `${cariEtiketi(ctx.tur)} kartı açılamadı: ${error?.message || "bilinmeyen hata"}`,
      })
      continue
    }

    const body = {
      companyId,
      type: isPurchase ? "PURCHASE" : "SALES",
      invoiceType: "MANUAL",
      invoiceNo: plan.invoiceNo,
      ...(isPurchase ? { supplierId: counterpartyId } : { customerId: counterpartyId }),
      date: plan.date,
      dueDate: plan.dueDate || null,
      currency: plan.currency,
      exchangeRate: plan.currency !== "TRY" ? plan.exchangeRate : null,
      exchangeRateDate: plan.currency !== "TRY" ? plan.date : null,
      notes: plan.notes || null,
      category: plan.category || null,
      tags: ctx.tur === "ihracat" ? [IHRACAT_ETIKETI] : [],
      globalDiscountAmount: plan.globalDiscount > 0 ? plan.globalDiscount : 0,
      items: plan.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountMode: line.discountMode,
        discountRate: line.discountRate,
        discountAmount: line.discountAmount,
        vatRate: line.vatRate,
        taxExemptionReasonCode: line.exemptionCode || null,
        taxExemptionReason: line.exemptionCode ? ISTISNA_GEREKCELERI[line.exemptionCode] ?? null : null,
      })),
    }

    const response = await createInvoiceFromBody(async () => body, actor)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      results.push({
        key: plan.key,
        invoiceNo: plan.invoiceNo,
        ok: false,
        error: data?.error || `Fatura yazılamadı (HTTP ${response.status}).`,
        createdCounterparty,
      })
      continue
    }

    const warnings: string[] = []
    if (data?.stockWarning) warnings.push(data.stockWarning)
    if (!isPurchase && data?.id) {
      try {
        await prisma.invoice.update({ where: { id: data.id }, data: { status: "SENT" } })
      } catch (error: any) {
        warnings.push(
          `${plan.invoiceNo} yazıldı ama onaylanamadı (taslak kaldı): ${error?.message || "bilinmeyen hata"} — faturayı açıp Onayla'ya basın.`,
        )
      }
    }
    results.push({
      key: plan.key,
      invoiceNo: plan.invoiceNo,
      ok: true,
      invoiceId: data?.id,
      invoiceSlug: data?.slug ?? null,
      warning: warnings.length > 0 ? warnings.join(" ") : undefined,
      createdCounterparty,
    })
  }

  return results
}
