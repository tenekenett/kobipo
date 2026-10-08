import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { E_INVOICE_CREDENTIAL_SELECT, resolveEInvoiceCredentials } from "@/lib/integrations/e-invoice/credentials"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import { designIdentity, matchForeignDesigns, type DesignCandidate, type DesignRow } from "./template-design"

/**
 * Tasarımı başka kayıtta duran şablonların tasarım satırını bulur (kural ve gerekçe
 * `template-design.ts`te). `field`: aranan görsel — logo ya da kaşe; tasarımda o görsel
 * yoksa eşleşme kurulmaz.
 */

const IDENTITY_SELECT = {
  id: true,
  taxNumber: true,
  eDonusumTenantVkn: true,
  ...E_INVOICE_CREDENTIAL_SELECT,
  parentCompany: {
    select: { taxNumber: true, ...E_INVOICE_CREDENTIAL_SELECT.parentCompany.select },
  },
} as const

type IdentityRow = Prisma.CompanyGetPayload<{ select: typeof IDENTITY_SELECT }>

const identityOf = (c: IdentityRow) => {
  const creds = resolveEInvoiceCredentials(c)
  return designIdentity({ tenantVkn: effectiveTenantVkn(c), username: creds?.username, baseUrl: creds?.baseUrl })
}

export async function findForeignDesigns(
  rows: DesignRow[],
  field: "logoDataUri" | "stampDataUri",
): Promise<Map<string, string>> {
  const external = rows.filter((r) => !r.hasDesign && !r.hidden)
  if (!external.length) return new Map()

  const owners = await prisma.company.findMany({
    where: { id: { in: [...new Set(external.map((r) => r.companyId))] } },
    select: IDENTITY_SELECT,
  })
  const vkns = [...new Set(owners.map((c) => effectiveTenantVkn(c)).filter(Boolean))]
  if (!vkns.length) return new Map()

  // Aday: aynı ad + görseli dolu tasarım, VKN'si eşleşen kayıtlarda. Kimlik (kullanıcı,
  // ortam) aşağıda TS'te sınanır — şifreli kimlik alanları SQL'de karşılaştırılmaz.
  const designs = await prisma.$queryRaw<DesignCandidate[]>(Prisma.sql`
    SELECT t.id, t."companyId", t."eDocumentType", t."xsltName", t."updatedAt"
    FROM einvoice_templates t
    JOIN companies c ON c.id = t."companyId"
    LEFT JOIN companies p ON p.id = c."parentCompanyId"
    WHERE t."xsltName" IN (${Prisma.join([...new Set(external.map((r) => r.xsltName))])})
      AND COALESCE(t.options->>${field}, '') <> ''
      AND (c."taxNumber" IN (${Prisma.join(vkns)})
        OR c."eDonusumTenantVkn" IN (${Prisma.join(vkns)})
        OR p."taxNumber" IN (${Prisma.join(vkns)}))
  `)
  if (!designs.length) return new Map()

  const designOwners = await prisma.company.findMany({
    where: { id: { in: [...new Set(designs.map((d) => d.companyId))] } },
    select: IDENTITY_SELECT,
  })
  const identities = new Map([...owners, ...designOwners].map((c) => [c.id, identityOf(c)]))
  return matchForeignDesigns(external, designs, (id) => identities.get(id))
}
