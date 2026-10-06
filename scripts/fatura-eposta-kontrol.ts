/**
 * FATURA E-POSTASI — ölçüm (lib/fatura-eposta/).
 *
 *   npx tsx scripts/fatura-eposta-kontrol.ts --giden=<faturaId|ETTN>        # salt okur
 *   npx tsx scripts/fatura-eposta-kontrol.ts --giden=<id> --gonder --to=<adres>
 *   npx tsx scripts/fatura-eposta-kontrol.ts --gelen                         # salt okur
 *
 * --giden : faturanın gönderilebilirliği, carinin adresi, Mysoft'tan resmî PDF + UBL XML
 *           (gerçekten indirilir), oluşan mail HTML'i dosyaya yazılır. GÖNDERMEZ, DB'ye
 *           YAZMAZ. `--gonder --to=` verilirse YALNIZ o adrese elle (MANUAL) gönderir ve
 *           kaydı invoice_email_logs'a düşer — migrasyon 20261006000002 uygulanmış olmalı.
 * --gelen : zamanlanmış işin ŞU AN ne yapacağı: hangi kutular çekilir (hesap × mükellef),
 *           son 72 saatte Mysoft'ta olup DB'de olmayan faturalar (bildirilecek yeniler),
 *           her hesabın kurucusu (maskeli). Mysoft'u okur, DB'ye YAZMAZ, mail ATMAZ.
 *
 * ÖN KOŞUL: .env.local canlı DB'ye bakar; Mysoft şifreleri çözülebilmeli.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const arg = (name: string) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "1"
}

const mask = (e: string | null | undefined) => {
  if (!e) return "—"
  const [u, d] = e.split("@")
  return `${u.slice(0, 2)}***@${d}`
}

async function giden(idOrUuid: string) {
  const { prisma } = await import("@/lib/db/prisma")
  const { faturaEpostaAdresi, gidenGonderilebilir, belgeTuruAdi } = await import("@/lib/fatura-eposta/kurallar")
  const { resolveCompanyEInvoiceProvider, COMPANY_PROVIDER_SELECT } = await import(
    "@/lib/integrations/e-invoice/company-provider"
  )
  const { gidenFaturaEmail } = await import("@/lib/email/templates")

  const inv = await prisma.invoice.findFirst({
    where: { OR: [{ id: idOrUuid }, { uuid: idOrUuid }] },
    select: {
      id: true,
      type: true,
      invoiceType: true,
      status: true,
      uuid: true,
      isReceipt: true,
      invoiceNo: true,
      eDocumentNo: true,
      date: true,
      totalAmount: true,
      currency: true,
      customer: { select: { name: true, email: true } },
      supplier: { select: { name: true, email: true } },
      company: { select: { name: true, email: true, ...COMPANY_PROVIDER_SELECT } },
    },
  })
  if (!inv) throw new Error("Fatura bulunamadı")
  console.log(`Fatura ${inv.eDocumentNo || inv.invoiceNo} · ${inv.invoiceType} · ${inv.status} · ${inv.company.name}`)
  const uygun = gidenGonderilebilir(inv)
  console.log("Gönderilebilir:", uygun.ok ? "evet" : `hayır — ${(uygun as any).sebep}`)
  const cari = inv.customer ?? inv.supplier
  const adres = faturaEpostaAdresi(cari?.email)
  console.log("Cari adresi:", adres.ok ? adres.adresler.map(mask).join(", ") : `yok (${adres.sebep})`)
  if (!uygun.ok) return

  const resolved = resolveCompanyEInvoiceProvider(inv.company)
  if (!resolved.ok) throw new Error(resolved.error)
  const t0 = Date.now()
  const pdf = await resolved.provider.getInvoicePdf(inv.uuid!)
  console.log("PDF:", pdf.success ? `${pdf.pdfBuffer.length} bayt, ${pdf.filename} (${Date.now() - t0} ms)` : `HATA ${pdf.error}`)
  const t1 = Date.now()
  const xml = await resolved.provider.getOutgoingInvoiceUblXml(inv.uuid!)
  console.log("XML:", xml.success ? `${xml.xml.length} karakter, ${xml.filename} (${Date.now() - t1} ms)` : `HATA ${xml.error}`)

  const { subject, html } = gidenFaturaEmail({
    companyName: inv.company.name,
    customerName: cari?.name ?? null,
    documentLabel: belgeTuruAdi(inv.invoiceType, inv.type),
    documentNo: inv.eDocumentNo || inv.invoiceNo,
    dateLabel: inv.date.toLocaleDateString("tr-TR", { timeZone: "UTC" }),
    amountLabel: new Intl.NumberFormat("tr-TR", { style: "currency", currency: inv.currency || "TRY" }).format(Number(inv.totalAmount)),
    ettn: inv.uuid!,
    isEInvoice: inv.invoiceType === "E_INVOICE",
    canReply: Boolean(inv.company.email),
  })
  const out = path.join(os.tmpdir(), `fatura-eposta-${inv.id}.html`)
  fs.writeFileSync(out, html)
  console.log("Konu:", subject)
  console.log("HTML:", out)

  if (arg("gonder")) {
    const to = arg("to")
    if (!to) throw new Error("--gonder için --to=<adres> zorunlu (cariye test maili atılmaz)")
    const { gidenFaturaEpostasi } = await import("@/lib/fatura-eposta/giden.server")
    const r = await gidenFaturaEpostasi(inv.id, { kind: "MANUAL", to, actorUserId: "script:fatura-eposta-kontrol" })
    console.log("GÖNDERİM:", r)
  }
}

async function gelen() {
  const { prisma } = await import("@/lib/db/prisma")
  const { resolveCompanyEInvoiceProvider, COMPANY_PROVIDER_SELECT } = await import(
    "@/lib/integrations/e-invoice/company-provider"
  )
  const { GELEN_TAZELIK_SAAT } = await import("@/lib/fatura-eposta/kurallar")
  const { hesapKurucusuBul } = await import("@/lib/fatura-eposta/kurucu.server")

  const firmalar = await prisma.company.findMany({
    where: { isEDonusumEnabled: true, isActive: true, archivedAt: null },
    select: { id: true, name: true, parentCompanyId: true, accountRootId: true, ...COMPANY_PROVIDER_SELECT },
    orderBy: { createdAt: "asc" },
  })
  const gruplar = new Map<string, { ids: string[]; first: (typeof firmalar)[number]; provider: any }>()
  for (const f of firmalar) {
    const r = resolveCompanyEInvoiceProvider(f)
    if (!r.ok) {
      console.log(`- ${f.name}: sağlayıcı yok (${r.error})`)
      continue
    }
    const key = `${f.accountRootId ?? f.id}:${r.mode}:${r.tenantVkn}`
    const g = gruplar.get(key)
    if (g) {
      g.ids.push(f.id)
      if (!f.parentCompanyId && g.first.parentCompanyId) g.first = f
    } else gruplar.set(key, { ids: [f.id], first: f, provider: r.provider })
  }
  console.log(`${firmalar.length} firma → ${gruplar.size} kutu (hesap × mükellef)\n`)

  const end = new Date()
  const start = new Date(end.getTime() - GELEN_TAZELIK_SAAT * 3_600_000)
  for (const [key, g] of gruplar) {
    const { kurucu } = await hesapKurucusuBul(g.first.id)
    const t0 = Date.now()
    const list = await g.provider.listIncomingInvoices({ startDate: start, endDate: end })
    if (!list.success) {
      console.log(`✗ ${g.first.name} [${key}]: ${list.error}`)
      continue
    }
    const uuids = list.data.map((r: any) => r.uuid).filter(Boolean)
    const mevcut = await prisma.incomingInvoice.findMany({
      where: { companyId: { in: g.ids }, uuid: { in: uuids } },
      select: { uuid: true },
    })
    const mevcutSet = new Set(mevcut.map((m) => m.uuid))
    const yeni = list.data.filter((r: any) => r.uuid && !mevcutSet.has(r.uuid))
    console.log(
      `✓ ${g.first.name} (${g.ids.length} firma) · kurucu ${mask(kurucu?.email)} · son ${GELEN_TAZELIK_SAAT} sa: ${list.data.length} fatura, DB'de olmayan ${yeni.length} (${Date.now() - t0} ms)`,
    )
    for (const r of yeni.slice(0, 5)) {
      console.log(`    · ${r.invoiceNo} ${r.sender?.name} ${r.totalAmount} ${r.currency} (${r.profile})`)
    }
  }
}

async function main() {
  const g = arg("giden")
  if (g) return giden(g)
  if (arg("gelen")) return gelen()
  console.log("Kullanım: --giden=<id|ETTN> [--gonder --to=<adres>] | --gelen")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/db/prisma")
    await prisma.$disconnect()
  })
