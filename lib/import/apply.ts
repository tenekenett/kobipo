/**
 * İçe aktarım satırının VERİTABANINA uygulanması: adayları bul, eşleştir,
 * güncelle ya da yeni kayıt aç.
 *
 * Uçtan (`app/api/import/route.ts`) ayrı durmasının sebebi kapsam: eşleştirmenin
 * bir kısmı SQL'in içinde (`mode: "insensitive"`) ve saf testle görülemez. Uç
 * bu fonksiyonları çağırır, canlı takım (`lib/import/apply.canli.test.ts`) da
 * AYNI fonksiyonları çağırır — testin doğruladığı yol üretimde koşan yoldur.
 *
 * Hata fırlatır; satır bazlı yakalama uçtadır (bir satırın hatası dosyayı
 * durdurmaz).
 */

import { prisma } from "@/lib/db/prisma"
import {
  cariUpdateData,
  describeMatchConflict,
  parseAmountCell,
  parseOpeningBalanceType,
  pickMatch,
  productUpdateData,
  type ImportGetter,
} from "./rows"

export type ImportRowOptions = {
  /** Mevcut kayda denk gelen satır güncellensin mi? Kapalıysa "çift kayıt" hatası. */
  updateExisting: boolean
  /** Güncellemede stok miktarı da yazılsın mı? (yalnız ürün) */
  updateStock: boolean
  /** Önizleme: karar verilir, veritabanına YAZILMAZ. */
  dryRun: boolean
}

/** Satırın sonucu — uç bunları ayrı sayar (yeni ≠ güncellenen). */
export type ImportRowResult = "created" | "updated"

export type CariKind = "customers" | "suppliers"

export async function applyProductRow(
  companyId: string,
  get: ImportGetter,
  options: ImportRowOptions,
): Promise<ImportRowResult> {
  const name = get("name")
  if (!name) throw new Error("name is required")

  const barcode = get("barcode")
  const code = get("code")

  // Aday havuzu: ada, barkoda ya da koda değen ürünler. Hangisinin geçerli
  // sayılacağına `pickMatch` sırayla karar verir (ad → barkod → kod).
  const candidates = await prisma.product.findMany({
    where: {
      companyId,
      OR: [
        { name: { equals: name, mode: "insensitive" as const } },
        ...(barcode ? [{ barcode: { equals: barcode, mode: "insensitive" as const } }] : []),
        ...(code ? [{ code: { equals: code, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, name: true, barcode: true, code: true },
  })

  // Sıra ADLA başlar: fiyat listesi çoğu zaman kod/barkod sütunu boş gelir.
  const outcome = pickMatch(candidates, [
    { by: "ad", value: name, of: (record) => record.name },
    { by: "barkod", value: barcode, of: (record) => record.barcode },
    { by: "kod", value: code, of: (record) => record.code },
  ])

  if (outcome.status === "conflict") throw new Error(describeMatchConflict(outcome.hits))

  if (outcome.status === "match") {
    if (!options.updateExisting) {
      throw new Error(`Çift ürün bulundu: "${outcome.record.name}" zaten mevcut`)
    }
    if (!options.dryRun) {
      await prisma.product.update({
        where: { id: outcome.record.id },
        data: productUpdateData(get, {
          updateStock: options.updateStock,
          matchedByName: outcome.by === "ad",
        }),
      })
    }
    return "updated"
  }

  if (options.dryRun) return "created"

  await prisma.product.create({
    data: {
      companyId,
      code: code || null,
      name,
      barcode: barcode || null,
      shelfCode: get("shelfcode") || null,
      category: get("category") || null,
      unit: get("unit") || "ADET",
      stockQuantity: parseAmountCell(get("stockquantity"), "Stok Miktarı") ?? 0,
      minStockLevel: parseAmountCell(get("minstocklevel"), "Min. Stok") ?? null,
      purchasePrice: parseAmountCell(get("purchaseprice"), "Alış Fiyatı") ?? null,
      salePrice: parseAmountCell(get("saleprice"), "Satış Fiyatı") ?? null,
      vatRate: parseAmountCell(get("vatrate"), "KDV Oranı") ?? 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })

  return "created"
}

export async function applyCariRow(
  companyId: string,
  kind: CariKind,
  get: ImportGetter,
  options: ImportRowOptions,
): Promise<ImportRowResult> {
  const isCustomer = kind === "customers"
  // İki model bu alanlarda birebir aynı; birleşim tipi çağrı imzalarını
  // eşleştiremediği için tek tipe daraltılıyor. Tek gövde olması şart:
  // tedarikçi dalı ayrıyken çift kayıt denetimi hiç yazılmamıştı ve aynı liste
  // ikinci kez yüklendiğinde her tedarikçi sessizce mükerrer açılıyordu.
  const model = (isCustomer ? prisma.customer : prisma.supplier) as typeof prisma.customer
  const label = isCustomer ? "cari" : "tedarikçi"

  const name = get("name")
  if (!name) throw new Error("name is required")

  const taxNumber = get("taxnumber")
  const code = get("code")

  const candidates = await model.findMany({
    where: {
      companyId,
      OR: [
        { name: { equals: name, mode: "insensitive" as const } },
        ...(taxNumber ? [{ taxNumber: { equals: taxNumber, mode: "insensitive" as const } }] : []),
        ...(code ? [{ code: { equals: code, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, name: true, taxNumber: true, code: true },
  })

  const outcome = pickMatch(candidates, [
    { by: "ad", value: name, of: (record) => record.name },
    { by: "VKN", value: taxNumber, of: (record) => record.taxNumber },
    { by: "kod", value: code, of: (record) => record.code },
  ])

  if (outcome.status === "conflict") throw new Error(describeMatchConflict(outcome.hits))

  if (outcome.status === "match") {
    if (!options.updateExisting) {
      throw new Error(`Çift ${label} bulundu: "${outcome.record.name}" zaten mevcut`)
    }
    if (!options.dryRun) {
      await model.update({
        where: { id: outcome.record.id },
        data: cariUpdateData(get, { matchedByName: outcome.by === "ad" }),
      })
    }
    return "updated"
  }

  if (options.dryRun) return "created"

  await model.create({
    data: {
      companyId,
      code: code || null,
      name,
      taxNumber: taxNumber || null,
      taxOffice: get("taxoffice") || null,
      phone: get("phone") || null,
      email: get("email") || null,
      address: get("address") || null,
      city: get("city") || null,
      contactPerson: get("contactperson") || null,
      paymentDueDays: get("paymentduedays")
        ? Math.max(0, Math.trunc(parseAmountCell(get("paymentduedays"), "Vade (gün)") ?? 0))
        : null,
      openingBalanceAmount: parseAmountCell(get("openingbalance"), "Açılış Bakiyesi") ?? 0,
      openingBalanceType: parseOpeningBalanceType(get("openingbalancetype")),
      riskLimit: parseAmountCell(get("risklimit"), "Risk Limiti") ?? null,
      bankInfo: get("bankinfo") || null,
      note: get("note") || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })

  return "created"
}
