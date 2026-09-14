/**
 * TÜRKÇE DUYARSIZ ARAMA — sorgular gerçekten çalışıyor mu?
 *
 *   npx tsx scripts/tr-arama-kontrol.ts              → SQL sağlaması (VERİ OKUMAZ)
 *   npx tsx scripts/tr-arama-kontrol.ts --firma=<id> → o firmada gerçek arama sonucu
 *
 * NEDEN VAR
 * Katlama iki yerde yapılıyor: JS'te `trFold()` (lib/text/tr-fold.ts) ve SQL'de
 * `lower(translate(...))` (lib/db/tr-search.ts). İkisi AYNI harf tablosundan
 * besleniyor ama aynı anahtarı ürettiklerini ancak gerçek bir Postgres söyler:
 * `translate` fazlalık harfi siler, `lower` veritabanının lc_ctype'ına bağlıdır.
 * Ayrışırlarsa ekranda eşleşen kayıt sunucuda bulunmaz ve hata SESSİZDİR.
 *
 * VARSAYILAN MOD VERİ OKUMAZ: companyId olarak var olmayan bir değer geçilir.
 * Postgres sorguyu yine ayrıştırıp planlar — tırnaklı sütun, `translate`
 * parametreleri, LIKE kaçışı ve LIMIT bağlaması sınanmış olur — ama sonuç daima
 * boştur. `--firma` verilirse o firmanın kendi verisinde gerçek arama yapılır.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { TR_FOLD_FROM, TR_FOLD_TO, trFold } from "@/lib/text/tr-fold"
import {
  trContainsIds,
  trEqualsIds,
  trLikePattern,
  trSearchDistinctValues,
} from "@/lib/db/tr-search"
import { fetchCustomerList, fetchSupplierList } from "@/lib/cari/list-query"
import { fetchInvoiceList } from "@/lib/faturalar/list-query"
import { buildIncomingWhere } from "@/lib/integrations/e-invoice/incoming-list-query"

const firmaArg = process.argv.find((a) => a.startsWith("--firma="))
const companyId = firmaArg ? firmaArg.split("=")[1] : "___tr_arama_kontrol_yok___"
const gercekVeri = Boolean(firmaArg)
const TERIM = process.argv.find((a) => a.startsWith("--terim="))?.split("=")[1] ?? "IŞIK"

let hata = 0

async function adim(ad: string, fn: () => Promise<unknown>) {
  try {
    const sonuc = await fn()
    const ozet = Array.isArray(sonuc) ? `${sonuc.length} kayıt` : JSON.stringify(sonuc)
    console.log(`  ✓ ${ad} → ${ozet}`)
  } catch (e) {
    hata += 1
    console.log(`  ✗ ${ad} → ${(e as Error).message.split("\n").slice(0, 3).join(" | ")}`)
  }
}

/** SQL ile JS aynı anahtarı üretiyor mu? Tek `SELECT`, tabloya dokunmaz. */
async function katlamaEsitligi() {
  const ornekler = [
    "IŞIK", "ışık", "Işık", "isik", "İstanbul", "ISTANBUL", "Şişli", "sisli",
    "ÇAĞLAYAN GIDA SAN. VE TİC. LTD. ŞTİ.", "Hâlâ Îî Ûû", "  boşluklu  ad  ", "TR12-345/A",
  ]
  const ayrisan: string[] = []
  for (const ornek of ornekler) {
    const rows = await prisma.$queryRaw<Array<{ folded: string }>>(Prisma.sql`
      SELECT lower(translate(btrim(t.value), ${TR_FOLD_FROM}, ${TR_FOLD_TO})) AS folded
      FROM (VALUES (${ornek}::text)) AS t(value)
    `)
    if (rows[0].folded !== trFold(ornek)) {
      ayrisan.push(`"${ornek}": SQL="${rows[0].folded}" ≠ JS="${trFold(ornek)}"`)
    }
  }
  if (ayrisan.length) throw new Error("AYRIŞMA — " + ayrisan.join(" ; "))
  return { ornek: ornekler.length, ayrisan: 0 }
}

async function main() {
  console.log(
    `\nTürkçe arama kontrolü — terim "${TERIM}" (katlanmış: "${trFold(TERIM)}", desen: ${trLikePattern(TERIM)})`,
  )
  console.log(gercekVeri ? `Firma: ${companyId} (GERÇEK VERİ)` : "Mod: SQL sağlaması (veri okunmaz)\n")

  await adim("SQL ↔ JS katlama eşitliği", katlamaEsitligi)

  await adim("ürün ön süzgeci", () =>
    trContainsIds({
      table: "products",
      columns: ["name", "code", "barcode", '"shelfCode"'],
      companyId,
      term: TERIM,
    }),
  )
  await adim("cari ön süzgeci", () =>
    trContainsIds({ table: "customers", columns: ["name"], companyId, term: TERIM }),
  )
  await adim("personel ön süzgeci", () =>
    trContainsIds({
      table: "employees",
      columns: ['"firstName"', '"lastName"', "department", "position"],
      companyId,
      term: TERIM,
    }),
  )
  await adim("gönderici ünvanları (gelen e-fatura)", () =>
    trSearchDistinctValues({
      table: "incoming_invoices",
      column: '"senderName"',
      companyId,
      term: TERIM,
    }),
  )
  await adim("içe aktarım aday havuzu (eşitlik)", () =>
    trEqualsIds({
      table: "customers",
      companyId,
      matches: [
        { column: "name", value: "Şeker A.Ş." },
        { column: '"taxNumber"', value: "1111111114" },
        { column: "code", value: "CR-1" },
      ],
    }),
  )
  await adim("LIKE joker kaçışı (% _ \\)", () =>
    trContainsIds({ table: "products", columns: ["name"], companyId, term: "%100_ind\\irim" }),
  )

  await adim("cari listesi (arama + sayfalama)", () =>
    fetchCustomerList({
      companyId,
      search: TERIM,
      paginate: true,
      visibility: { kind: "all" },
    }).then((r) => r.items),
  )
  await adim("tedarikçi listesi (arama)", () =>
    fetchSupplierList({ companyId, search: TERIM, visibility: { kind: "all" } }).then((r) => r.items),
  )
  await adim("fatura listesi (arama + karşı taraf + VKN)", () =>
    fetchInvoiceList({ companyId, search: TERIM, counterparty: TERIM, taxNumber: "111" }).then(
      (r) => ({ satir: r.count }),
    ),
  )
  await adim("gelen e-fatura süzgeci (q + gönderici)", async () => {
    const where = await buildIncomingWhere(companyId, {
      dateField: "docDate",
      startDate: new Date(0),
      endDate: new Date(),
      status: "BEKLEMEDE",
      profile: "",
      linked: "",
      q: TERIM,
      sender: TERIM,
      taxNumber: "",
      minAmount: null,
      maxAmount: null,
    })
    return { sayi: await prisma.incomingInvoice.count({ where }) }
  })

  await prisma.$disconnect()
  console.log(hata === 0 ? "\nTümü geçti.\n" : `\n${hata} adım BAŞARISIZ.\n`)
  process.exit(hata === 0 ? 0 : 1)
}

main()
