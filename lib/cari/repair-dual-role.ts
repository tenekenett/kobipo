import { prisma } from "@/lib/db/prisma"

/** Form / JSON'dan gelen değeri güvenli boolean'a çevir (string "true"/"false" dahil) */
export function toBool(v: unknown): boolean {
  if (v === true || v === 1) return true
  if (v === false || v === 0 || v === null || v === undefined || v === "") return false
  if (typeof v === "string") {
    const s = v.toLowerCase().trim()
    if (s === "false" || s === "0" || s === "no" || s === "off") return false
    return s === "true" || s === "1" || s === "yes" || s === "on"
  }
  return Boolean(v)
}

/**
 * isAlsoSupplier true ama linkedSupplierId null olan müşteriler (eski hata / yarım kayıt)
 * için tedarikçi satırı oluşturur ve bağlar.
 */
export async function repairOrphanDualRoleCustomers(companyId: string): Promise<void> {
  const orphans = await prisma.customer.findMany({
    where: { companyId, isAlsoSupplier: true, linkedSupplierId: null },
    select: { id: true },
  })
  for (const { id } of orphans) {
    try {
      await prisma.$transaction(async (tx) => {
        const c = await tx.customer.findUnique({ where: { id } })
        if (!c || !c.isAlsoSupplier || c.linkedSupplierId) return

        const linkedSupplier = await tx.supplier.create({
          data: {
            companyId: c.companyId,
            code: c.code,
            name: c.name,
            nickname: c.nickname,
            taxNumber: c.taxNumber,
            taxOffice: c.taxOffice,
            address: c.address,
            city: c.city,
            phone: c.phone,
            email: c.email,
            contactPerson: c.contactPerson,
            paymentDueDays: c.paymentDueDays,
            isAlsoCustomer: true,
            linkedCustomerId: c.id,
          },
        })
        await tx.customer.update({
          where: { id: c.id },
          data: { linkedSupplierId: linkedSupplier.id },
        })
      })
    } catch (e) {
      console.error("[repairOrphanDualRoleCustomers]", id, e)
    }
  }
}

/**
 * isAlsoCustomer true ama bağlı müşteri (linkedSupplierId = bu tedarikçi) yoksa müşteri oluşturur.
 */
export async function repairOrphanDualRoleSuppliers(companyId: string): Promise<void> {
  const candidates = await prisma.supplier.findMany({
    where: { companyId, isAlsoCustomer: true },
    select: { id: true },
  })
  for (const { id } of candidates) {
    try {
      const linked = await prisma.customer.findFirst({
        where: { linkedSupplierId: id },
        select: { id: true },
      })
      if (linked) continue

      await prisma.$transaction(async (tx) => {
        const s = await tx.supplier.findUnique({ where: { id } })
        if (!s || !s.isAlsoCustomer) return
        const exists = await tx.customer.findFirst({ where: { linkedSupplierId: s.id } })
        if (exists) return

        const created = await tx.customer.create({
          data: {
            companyId: s.companyId,
            code: s.code,
            name: s.name,
            nickname: s.nickname,
            taxNumber: s.taxNumber,
            taxOffice: s.taxOffice,
            address: s.address,
            city: s.city,
            phone: s.phone,
            email: s.email,
            contactPerson: s.contactPerson,
            paymentDueDays: s.paymentDueDays,
            isAlsoSupplier: true,
            linkedSupplierId: s.id,
          },
        })
        await tx.supplier.update({
          where: { id: s.id },
          data: { linkedCustomerId: created.id, isAlsoCustomer: true },
        })
      })
    } catch (e) {
      console.error("[repairOrphanDualRoleSuppliers]", id, e)
    }
  }
}
