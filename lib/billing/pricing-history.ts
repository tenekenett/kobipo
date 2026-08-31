// Katalog değişikliklerini günlüğe yazan tek yol.
//
// Kural: fiyat/paket yazan HER uç, yazmadan ÖNCEKİ hâli okuyup buraya vermek zorunda.
// "Sonra bakarız" diye ertelenen bir kayıt değil bu — eski değer, UPDATE çalıştığı anda
// geri dönülemez biçimde kayboluyor.
//
// Günlük APPEND-ONLY'dir ve ASLA fırlatmaz: gözlem katmanının kendisi bir fiyat
// güncellemesini yarıda bırakmamalı. Ama sessiz de geçmez — hata `console.error` ile
// bağırır, yoksa günlüğün çalışmadığını fark etmeden ona güvenmeye devam ederiz.

import { prisma } from "@/lib/db/prisma"

export type PricingTargetKind = "PRICING_ITEM" | "PLAN"

/** Bir kalemin günlüğe girecek alanları. Karşılaştırma metin üzerinden yapılır. */
type FieldMap = Record<string, unknown>

/** Karşılaştırılabilir tek biçim: sayı 2 haneye, dizi sıralı listeye, null boş metne. */
function normalize(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "boolean") return value ? "evet" : "hayır"
  if (Array.isArray(value)) return [...value].map(String).sort().join(", ")
  const n = Number(value)
  // Decimal, string ve number aynı biçime indirgenir: "20" ile "20.00" fark sayılmamalı.
  if (typeof value !== "string" || value.trim() !== "") {
    if (Number.isFinite(n)) return n.toFixed(2)
  }
  return String(value)
}

export type PricingChangeInput = {
  kind: PricingTargetKind
  targetKey: string
  targetLabel: string
  before: FieldMap
  after: FieldMap
  changedById?: string | null
}

/**
 * Önceki ve sonraki hâli karşılaştırıp DEĞİŞEN her alan için bir satır yazar.
 * Değişiklik yoksa hiçbir şey yazılmaz — günlüğü "kaydet'e basıldı" gürültüsüyle
 * doldurmak, içinden gerçek fiyat değişikliğini aramayı zorlaştırır.
 */
export async function logPricingChanges(inputs: PricingChangeInput[]): Promise<number> {
  const rows: {
    targetKind: string
    targetKey: string
    targetLabel: string
    field: string
    oldValue: string
    newValue: string
    changedById: string | null
  }[] = []

  for (const input of inputs) {
    for (const [field, next] of Object.entries(input.after)) {
      const oldValue = normalize(input.before[field])
      const newValue = normalize(next)
      if (oldValue === newValue) continue
      rows.push({
        targetKind: input.kind,
        targetKey: input.targetKey,
        targetLabel: input.targetLabel,
        field,
        oldValue,
        newValue,
        changedById: input.changedById ?? null,
      })
    }
  }

  if (rows.length === 0) return 0

  try {
    await prisma.pricingChange.createMany({ data: rows })
    return rows.length
  } catch (error) {
    console.error(`[pricing-history] ${rows.length} değişiklik YAZILAMADI:`, error)
    return 0
  }
}

/** İnsan okunur alan adları — tarihçe ekranı bunları basar. */
export const PRICING_FIELD_LABELS: Record<string, string> = {
  monthlyPrice: "Aylık fiyat",
  yearlyPrice: "Yıllık fiyat",
  isFree: "Ücretsiz",
  isActive: "Aktif",
  label: "Etiket",
  name: "Ad",
  includedModules: "Dahil modüller",
  includedBranches: "Dahil şube",
  includedCompanies: "Dahil ek firma",
  maxUsers: "Kullanıcı sınırı",
}

/** Katalog değişiklik geçmişi (en yeni önce). */
export async function getPricingChanges(limit = 200) {
  const changes = await prisma.pricingChange.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 500),
  })

  const userIds = Array.from(
    new Set(changes.map((c) => c.changedById).filter((v): v is string => Boolean(v))),
  )
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const byId = new Map(users.map((u) => [u.id, u.name || u.email]))

  return changes.map((c) => ({
    id: c.id,
    targetKind: c.targetKind,
    targetLabel: c.targetLabel,
    field: c.field,
    fieldLabel: PRICING_FIELD_LABELS[c.field] ?? c.field,
    oldValue: c.oldValue,
    newValue: c.newValue,
    changedByName: c.changedById ? byId.get(c.changedById) ?? null : null,
    createdAt: c.createdAt.toISOString(),
  }))
}
