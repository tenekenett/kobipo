/**
 * FATURA ŞABLONU GİDİŞ-DÖNÜŞ — salt okur (alış ya da satış).
 *
 *   npx tsx scripts/fatura-sablon-kontrol.ts --yon=alis|satis [--firma=<companyId>] [--gun=365] [--ilk=4]
 *
 * NE ÖLÇER (hiçbir şey yazmaz): "Kobipo Şablonu ile Dışarı Aktar" dosyasını üretir
 * (lib/export/datasets/fatura-sablon.ts), xlsx'i yeniden okur ve "İçeri Aktar"ın
 * planından geçirir (lib/faturalar/fatura-ice-aktar.ts → prepareFaturaImport).
 *
 * Beklenen: her fatura "zaten kayıtlı" der (aynı fatura veritabanında var). "toplam
 * tutmadı" yalnız dosyanın notunda sayılan faturalarda çıkmalı; "DİĞER HATA" veri
 * sorunudur (ör. carisiz fatura) ve örneği yazdırılır. --firma verilmezse o yönde en
 * çok faturası olan firmalar taranır. Sonda boş şablon + örnek sayfası okunur
 * (satışta ihracat şablonu da).
 *
 * ÖN KOŞUL: .env.local veritabanına erişmeli.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const args = process.argv.slice(2)
const arg = (k: string) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || ""

async function main() {
  const XLSX = await import("xlsx")
  const { prisma } = await import("@/lib/db/prisma")
  const { buildFaturaSablonDataset } = await import("@/lib/export/datasets/fatura-sablon")
  const { buildXlsx } = await import("@/lib/export/xlsx")
  const { parseFaturaSablonu, faturaSablonToplami } = await import("@/lib/faturalar/fatura-sablon")
  const { prepareFaturaImport } = await import("@/lib/faturalar/fatura-ice-aktar")
  const { CARI_VISIBILITY_ALL } = await import("@/lib/cari/visibility")

  const yon = arg("yon") === "satis" ? "satis" : "alis"
  const tur = yon
  const days = arg("gun") || "365"
  let companyIds = arg("firma") ? [arg("firma")] : []
  if (companyIds.length === 0) {
    const top = await prisma.invoice.groupBy({
      by: ["companyId"],
      where: { type: yon === "alis" ? "PURCHASE" : "SALES", isReceipt: false },
      _count: { _all: true },
      orderBy: { _count: { companyId: "desc" } },
      take: Number(arg("ilk") || 4),
    })
    companyIds = top.map((t) => t.companyId)
  }

  const readFirst = (buffer: Buffer, sheet?: string) => {
    const wb = XLSX.read(buffer, { type: "buffer" })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as unknown[][]
    return { wb, rows }
  }

  for (const companyId of companyIds) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
    console.log(`\n=== [${yon}] ${company?.name} (${companyId}) — son ${days} gün ===`)

    const dataset = await buildFaturaSablonDataset({ companyId, yon, days })
    const { wb, rows: sheetRows } = readFirst(buildXlsx(dataset))
    console.log(`sayfalar: ${wb.SheetNames.join(" | ")} · kalem satırı: ${dataset.sections[0].rows.length} · not: ${dataset.note ?? "-"}`)

    const parsed = parseFaturaSablonu(sheetRows, tur)
    if (parsed.fileError || parsed.missingColumns.length) {
      console.log("DOSYA:", parsed.fileError, parsed.missingColumns)
      continue
    }
    const parseErrors = parsed.invoices.filter((i) => i.errors.length > 0)
    console.log(`fatura: ${parsed.invoices.length} · ayrıştırma hatası: ${parseErrors.length} · tanınmayan sütun: ${parsed.unknownColumns.join(",") || "-"}`)

    let totalMismatch = 0
    for (const inv of parsed.invoices) {
      if (inv.errors.length) continue
      const t = faturaSablonToplami(inv)
      if (inv.expectedTotal !== null && Math.abs(inv.expectedTotal - t.total) > 0.01) totalMismatch++
    }

    const plans = await prepareFaturaImport(companyId, parsed.invoices, {
      tur,
      visibility: CARI_VISIBILITY_ALL,
      canCreateCounterparty: false,
    })
    const buckets = new Map<string, number>()
    const samples = new Map<string, string>()
    for (const plan of plans) {
      const kind =
        plan.errors.length === 0
          ? "HAZIR (beklenmez: DB'de zaten var)"
          : plan.errors.some((e) => e.includes("zaten kayıtlı"))
            ? "zaten kayıtlı (beklenen)"
            : plan.errors.some((e) => e.includes("Genel Toplam"))
              ? "toplam tutmadı (notta sayılan)"
              : "DİĞER HATA"
      buckets.set(kind, (buckets.get(kind) ?? 0) + 1)
      if (!samples.has(kind)) samples.set(kind, `${plan.invoiceNo}: ${plan.errors.join(" | ") || "-"}`)
    }
    console.log(`hesaplanan≠belge toplamı: ${totalMismatch}`)
    for (const [kind, n] of buckets) console.log(`  ${kind}: ${n}   örn. ${samples.get(kind)}`)
    // Veri sorunları türlerine göre: ilk hata metninin kalıbı (satır no'suz).
    const other = new Map<string, string[]>()
    for (const plan of plans) {
      const first = plan.errors[0]
      if (!first || first.includes("zaten kayıtlı") || plan.errors.some((e) => e.includes("Genel Toplam"))) continue
      const pattern = first.replace(/^Satır \d+: /, "").replace(/"[^"]*"/g, '"…"').replace(/\([^)]*\)/g, "(…)")
      other.set(pattern, [...(other.get(pattern) ?? []), plan.invoiceNo])
    }
    for (const [pattern, nos] of other) console.log(`    · ${nos.length}× ${pattern}  [${nos.slice(0, 4).join(", ")}]`)
  }

  // Boş şablon + örnek sayfası
  const any = companyIds[0]
  const empties: Array<{ label: string; tur: "alis" | "satis" | "ihracat" }> =
    yon === "alis" ? [{ label: "alış", tur: "alis" }] : [{ label: "satış", tur: "satis" }, { label: "ihracat", tur: "ihracat" }]
  for (const e of empties) {
    const ds = await buildFaturaSablonDataset({ companyId: any, yon, empty: true, tur: e.tur })
    const buffer = buildXlsx(ds)
    const bos = parseFaturaSablonu(readFirst(buffer).rows, e.tur)
    const ornek = parseFaturaSablonu(readFirst(buffer, "Örnek").rows, e.tur)
    const inv = ornek.invoices[0]
    console.log(
      `\nBOŞ ŞABLON (${e.label}) "${ds.title}" · veri: ${bos.fileError} · eksik sütun: ${bos.missingColumns.join(",") || "-"}` +
        ` · ÖRNEK: ${ornek.invoices.length} fatura, ${inv?.lines.length} kalem, hata: ${JSON.stringify(inv?.errors)},` +
        ` toplam: ${JSON.stringify(inv && faturaSablonToplami(inv))}`,
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
