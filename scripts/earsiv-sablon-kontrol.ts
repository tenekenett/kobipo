/**
 * E-ARŞİV ŞABLON ONAYI — Mysoft belgeyi hangi dizaynla basıyor, basıyor mu?
 *
 *   npx tsx scripts/earsiv-sablon-kontrol.ts --test                          → Mysoft TEST ortamı (env MYSOFT_*)
 *   npx tsx scripts/earsiv-sablon-kontrol.ts --firma=<companyId>            → firmanın kayıtlı Mysoft kimliğiyle
 *   npx tsx scripts/earsiv-sablon-kontrol.ts --bayi-vkn=<vkn> [--xslt=<ad>] [--prefix=<seri>]
 *                                                                          → bayi (iş ortağı) kimliğiyle, o mükellef adına
 *
 * NE ÖLÇER: mükellefin getTenantXslt listesi (onaylı / onay bekliyor / Mysoft
 * varsayılan) ve üç taslak PDF denemesi — (1) aktif/verilen şablon adıyla,
 * (2) xsltName olmadan, (3) bilerek olmayan bir adla. Belge FİİLEN basılır ama
 * getInvoiceOutboxDraftPdfAsZip önizlemedir: GİB'e gitmez, Mysoft'ta kayıt bırakmaz.
 *
 * NEDEN VAR (2026-09-14): canlı Mysoft e-Arşiv'de yalnız ONAYLI şablonla belge
 * üretiyor; onay bekleyen/olmayan ad ve "genel dizayna düş" bayrağı reddediliyor
 * (test ortamı düşürüyor — oradan bakıp "çalışıyor" denmesin). Eren Forklift'te
 * 3 Eylül'de yeniden yüklenen şablon onaydan düşünce 9–14 Eylül arası e-Arşiv
 * kesilemedi. Provider artık bu ret gelince mükellefin onaylı e-Arşiv şablonuna bir
 * kez daha deniyor; çıktıda "yedek:" satırı bunu gösterir (bkz. template-approval.ts).
 *
 * --firma ÖN KOŞULU: kayıtlı Mysoft şifresi canlının NEXTAUTH_SECRET'iyle çözülür —
 * `vercel env pull .env.local --environment=production` (doğru Vercel hesabıyla).
 * --bayi-vkn yalnız Kobipo bayiliği altındaki mükellefleri görür.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"

const args = process.argv.slice(2)
const TEST = args.includes("--test")
const FIRMA = (args.find((a) => a.startsWith("--firma=")) || "").split("=")[1] || ""
const BAYI_VKN = (args.find((a) => a.startsWith("--bayi-vkn=")) || "").split("=")[1] || ""

async function hedef(): Promise<{ provider: any; baslik: string; prefix?: string; tenantVkn?: string; xslt?: string }> {
  if (TEST) {
    const username = process.env.MYSOFT_USERNAME?.trim()
    const password = process.env.MYSOFT_PASSWORD?.trim()
    const baseUrl = process.env.MYSOFT_API_URL?.trim()
    if (!username || !password) throw new Error("MYSOFT_USERNAME / MYSOFT_PASSWORD yok")
    return { provider: new MysoftEInvoiceProvider({ username, passwordText: password, baseUrl }), baslik: `TEST ORTAMI (${baseUrl})` }
  }
  if (BAYI_VKN) {
    // Bayi (iş ortağı) kimliğiyle, mükellefin VKN'si tenantIdentifierNumber olarak.
    const { createPartnerProvider } = await import("@/lib/integrations/e-invoice/partner")
    const provider = createPartnerProvider(BAYI_VKN)
    if (!provider) throw new Error("Bayi kimliği yok (MYSOFT_PARTNER_*)")
    return { provider, baslik: `BAYİ kimliğiyle mükellef VKN=${BAYI_VKN}`, tenantVkn: BAYI_VKN, xslt: (args.find((a) => a.startsWith("--xslt=")) || "").split("=")[1] || undefined, prefix: (args.find((a) => a.startsWith("--prefix=")) || "").split("=")[1] || undefined }
  }
  const { prisma } = await import("@/lib/db/prisma")
  const { COMPANY_PROVIDER_SELECT, resolveCompanyEInvoiceProvider } = await import("@/lib/integrations/e-invoice/company-provider")
  const { getActiveXsltName } = await import("@/lib/integrations/e-invoice/active-template")
  const company = await prisma.company.findUnique({
    where: { id: FIRMA },
    select: { ...COMPANY_PROVIDER_SELECT, name: true, eArchivePrefix: true },
  })
  if (!company) throw new Error("Firma yok: " + FIRMA)
  const resolved: any = resolveCompanyEInvoiceProvider(company as any)
  if (!resolved.ok) throw new Error("Sağlayıcı kurulamadı: " + resolved.error)
  const xslt = (await getActiveXsltName(FIRMA, 2)) || undefined
  await prisma.$disconnect()
  return { provider: resolved.provider, baslik: `${company.name} [${resolved.mode}]`, prefix: company.eArchivePrefix || undefined, tenantVkn: resolved.tenantVkn || undefined, xslt }
}

async function main() {
  const { provider, baslik, prefix, tenantVkn, xslt } = await hedef()
  console.log(`\n=== ${baslik} | prefix=${prefix ?? "(yok)"} | aktif e-Arşiv şablonu=${xslt ?? "(yok)"}`)

  const list = await provider.listTenantXslt(tenantVkn)
  console.log("\n--- Mysoft getTenantXslt:", list.success ? `${list.data.length} kayıt` : "HATA " + list.error)
  if (list.success) console.table(list.data.map((x: any) => ({ id: x.id, tip: x.eDocumentTypeEnumText, xsltName: x.xsltName, isDefault: x.isDefault, isApproved: x.isApproved, approvedDate: x.approvedDate })))

  const dene = async (etiket: string, extra: any) => {
    const r: any = await provider.sendInvoice({
      invoiceType: "E_ARCHIVE",
      draftPdfOnly: true,
      prefix,
      tenantIdentifierNumber: tenantVkn,
      date: new Date(),
      invoiceNo: "TESHIS-TEST",
      customer: { name: "SON KULLANICI", taxNumber: "11111111111", city: "İSTANBUL", district: "KADIKÖY", address: "TEST ADRES" },
      items: [{ description: "Deneme Ürün", quantity: 1, unitPrice: 100, vatRate: 20, productId: "URN-1" }],
      ...extra,
    })
    const yedek = r?.templateFallback
      ? ` | yedek: "${r.templateFallback.requested ?? "(yok)"}" → "${r.templateFallback.used}"`
      : ""
    console.log(
      `\n--- ${etiket}\n    → ${
        r?.success
          ? "OK: taslak PDF üretildi (" + (r.pdfBuffer?.length ?? 0) + " bayt)" + yedek
          : "HATA: " + r?.error
      }`,
    )
  }
  if (xslt) await dene(`xsltName="${xslt}" ile (gönderimdeki gibi)`, { xsltName: xslt })
  await dene("xsltName OLMADAN (isSendWithGeneralXsltIfDefaultNotExists=true)", {})
  await dene(`xsltName="olmayan-sablon" (bilerek yanlış ad)`, { xsltName: "olmayan-sablon-xyz" })
}
main().catch((e) => { console.error("HATA:", e?.message || e); process.exit(1) })
