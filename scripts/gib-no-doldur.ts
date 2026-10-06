/**
 * EKSİK GİB BELGE NUMARASI — GİB'e gitmiş e-belgelerde `Invoice.eDocumentNo` boşsa
 * Mysoft'tan ETTN ile okuyup doldurur.
 *
 *   npx tsx scripts/gib-no-doldur.ts                 # salt okur: adaylar + Mysoft'un numarası
 *   npx tsx scripts/gib-no-doldur.ts --yaz           # bulunan numaraları yazar
 *   npx tsx scripts/gib-no-doldur.ts --firma=<id>    # tek firma
 *   npx tsx scripts/gib-no-doldur.ts --bayi          # şifresi çözülemeyen firmada bayi kimliği
 *
 * NEDEN EKSİK: numara kaydı 2026-06-25'te geldi (ff5e9de — gönderim yolu ve "durum sorgula"
 * ucu o günden beri Mysoft'un `docNo`sunu yazar). Öncesinde gönderilen belgelerde yalnız
 * Kobipo numarası (SAT-2026-0009) ve ETTN kaldı; ekranlar `eDocumentNo || invoiceNo`
 * kuralıyla GİB numarası yerine Kobipo numarasını gösteriyordu. 2026-10-06 ölçümü: 40 belge,
 * hepsi 13 Mayıs – 25 Haziran arası; 7'si `MOCK-` ETTN'li (sahte sağlayıcı denemesi, GİB'de
 * karşılığı yok — atlanır).
 *
 * YALNIZ NUMARA yazar. Durumu DEĞİŞTİRMEZ: "durum sorgula" ucu (check-status) iptal/red
 * görünce faturayı iptale çeker; bu betik onu yapmaz, Mysoft'un durumunu yalnız raporlar.
 * Numara GİB biçiminde değilse ya da aynı firmada başka belgede varsa yazılmaz.
 *
 * ÖN KOŞUL: Mysoft şifreleri çözülebilmeli. .env.local canlı firmaların şifresini ÇÖZEMEZ
 * (NEXTAUTH_SECRET farklı); canlı firmalar için `GIB_NO_SECRET_ENV=<dosya>` ile üretimin
 * env dosyası verilir (`vercel env pull --environment=production <dosya>`), yalnız
 * NEXTAUTH_SECRET oradan okunur. Dosyayı iş bitince silin.
 * `--bayi`: şifre çözülemezse Kobipo'nun Mysoft bayi kimliğiyle (MYSOFT_PARTNER_*, açık metin)
 * mükellef VKN'si adına sorulur — yalnız bayilik altındaki mükellefler görünür.
 */
import "dotenv/config"
import fs from "node:fs"
import { config as loadEnv, parse } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const secretFile = process.env.GIB_NO_SECRET_ENV
if (secretFile) {
  const prod = parse(fs.readFileSync(secretFile))
  if (!prod.NEXTAUTH_SECRET) throw new Error(`${secretFile} içinde NEXTAUTH_SECRET yok`)
  process.env.NEXTAUTH_SECRET = prod.NEXTAUTH_SECRET
}

const args = process.argv.slice(2)
const arg = (name: string) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "1"
}
const YAZ = Boolean(arg("yaz"))
const FIRMA = arg("firma")
const BAYI = Boolean(arg("bayi"))

/** GİB belge numarası: 3 karakter seri + 4 hane yıl + 9 hane sıra (ADM2026000000018). */
const GIB_NO = /^[A-Z0-9]{3}\d{4}\d{9}$/

type Durum = { docNo?: string; status?: string; error?: string }
type Sorgucu = { ok: true; durumSor: (uuid: string) => Promise<Durum> } | { ok: false; error: string }

/**
 * Bayi kimliğiyle mükellef adına giden belge durumu. Sağlayıcının getInvoiceStatus'u
 * tenantIdentifierNumber göndermez (firma kendi kimliğiyle sorar; normal girişte bu
 * parametre "firma kullanıcı bulunamadı" doğurabiliyor) — o yüzden burada ayrı istek.
 * Swagger v8: GET /api/InvoiceOutbox/getInvoiceOutboxStatus?invoiceETTN=&tenantIdentifierNumber=
 */
async function bayiSorgucu(vkn: string, firmaHatasi: string): Promise<Sorgucu> {
  const { getPartnerCredentials } = await import("@/lib/integrations/e-invoice/partner")
  const creds = getPartnerCredentials()
  if (!creds || !vkn) return { ok: false, error: `${firmaHatasi} (bayi kimliği ya da VKN yok)` }
  let token: string | null = null
  return {
    ok: true,
    durumSor: async (uuid) => {
      if (!token) {
        const t = await fetch(`${creds.baseUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username: creds.username, password: creds.password, grant_type: "password" }),
        })
        token = ((await t.json()) as any).access_token || null
        if (!token) return { error: "Bayi token alınamadı" }
      }
      const url = new URL(`${creds.baseUrl}/api/InvoiceOutbox/getInvoiceOutboxStatus`)
      url.searchParams.set("invoiceETTN", uuid)
      url.searchParams.set("tenantIdentifierNumber", vkn)
      const res: any = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()
      if (!res?.succeed) return { error: res?.message || "Durum sorgulanamadı." }
      return { docNo: res.data?.docNo, status: res.data?.invoiceStatusText }
    },
  }
}

async function main() {
  const { prisma } = await import("@/lib/db/prisma")
  const { resolveCompanyEInvoiceProvider, COMPANY_PROVIDER_SELECT } = await import(
    "@/lib/integrations/e-invoice/company-provider"
  )

  const adaylar = await prisma.invoice.findMany({
    where: {
      status: "SENT",
      invoiceType: { in: ["E_INVOICE", "E_ARCHIVE"] },
      type: { not: "PURCHASE" },
      eDocumentNo: null,
      uuid: { not: null },
      ...(FIRMA ? { companyId: FIRMA } : {}),
    },
    select: {
      id: true,
      companyId: true,
      invoiceNo: true,
      invoiceType: true,
      date: true,
      uuid: true,
      company: { select: { name: true, ...COMPANY_PROVIDER_SELECT } },
    },
    orderBy: { createdAt: "asc" },
  })

  console.log(`${adaylar.length} aday${YAZ ? " — YAZMA KİPİ" : " — salt okur (yazmak için --yaz)"}\n`)
  const ozet = { yazildi: 0, bulundu: 0, mock: 0, saglayiciYok: 0, numaraYok: 0, gecersiz: 0, cakisma: 0, hata: 0 }
  const sorgucular = new Map<string, Sorgucu>()

  for (const inv of adaylar) {
    const etiket = `${inv.company.name.slice(0, 22).padEnd(22)} ${inv.invoiceNo.padEnd(15)} ${inv.invoiceType.padEnd(10)}`
    if (inv.uuid!.startsWith("MOCK-")) {
      ozet.mock++
      console.log(`· ${etiket} atlandı: sahte sağlayıcı ETTN'i (GİB'de yok)`)
      continue
    }

    let sorgu = sorgucular.get(inv.companyId)
    if (!sorgu) {
      const resolved = resolveCompanyEInvoiceProvider(inv.company)
      if (resolved.ok) {
        sorgu = { ok: true, durumSor: (uuid) => resolved.provider.getInvoiceStatus(uuid) }
      } else if (BAYI) {
        const vkn = (inv.company.eDonusumTenantVkn || inv.company.taxNumber || "").replace(/\D/g, "")
        sorgu = await bayiSorgucu(vkn, resolved.error)
      } else {
        sorgu = { ok: false, error: resolved.error }
      }
      sorgucular.set(inv.companyId, sorgu)
    }
    if (!sorgu.ok) {
      ozet.saglayiciYok++
      console.log(`✗ ${etiket} sağlayıcı yok: ${sorgu.error}`)
      continue
    }

    try {
      const r: any = await sorgu.durumSor(inv.uuid!)
      const docNo = typeof r?.docNo === "string" ? r.docNo.trim().toUpperCase() : ""
      const durum = r?.status ? ` (Mysoft durumu: ${r.status})` : ""
      if (!docNo) {
        ozet.numaraYok++
        console.log(`✗ ${etiket} Mysoft numara döndürmedi${durum}${r?.error ? ` — ${r.error}` : ""}`)
        continue
      }
      if (!GIB_NO.test(docNo)) {
        ozet.gecersiz++
        console.log(`✗ ${etiket} GİB biçiminde değil: ${docNo}${durum}`)
        continue
      }
      const cakisan = await prisma.invoice.findFirst({
        where: { companyId: inv.companyId, eDocumentNo: docNo, id: { not: inv.id } },
        select: { invoiceNo: true },
      })
      if (cakisan) {
        ozet.cakisma++
        console.log(`✗ ${etiket} ${docNo} firmada zaten ${cakisan.invoiceNo} faturasında — yazılmadı${durum}`)
        continue
      }

      ozet.bulundu++
      if (!YAZ) {
        console.log(`✓ ${etiket} → ${docNo}${durum}`)
        continue
      }
      // Koşullu: arada biri doldurduysa ezilmez.
      const w = await prisma.invoice.updateMany({
        where: { id: inv.id, eDocumentNo: null },
        data: { eDocumentNo: docNo },
      })
      if (w.count === 1) ozet.yazildi++
      console.log(`${w.count === 1 ? "✓ yazıldı" : "· zaten dolu"} ${etiket} → ${docNo}${durum}`)
    } catch (error: any) {
      ozet.hata++
      console.log(`✗ ${etiket} hata: ${error?.message || error}`)
    }
  }

  console.log("\nÖzet:", ozet)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
