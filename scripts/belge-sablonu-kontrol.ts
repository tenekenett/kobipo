/**
 * İK belge şablonu zincirinin ÖLÇÜMÜ — salt okur, hiçbir şey yazmaz.
 *
 *   npx tsx scripts/belge-sablonu-kontrol.ts                     # katalog + alan çözümü
 *   npx tsx scripts/belge-sablonu-kontrol.ts --firma=<id|slug>   # gerçek firma verisiyle
 *   npx tsx scripts/belge-sablonu-kontrol.ts --firma=<id> --pdf  # PDF de üretir (/tmp)
 *
 * Neden ayrı bir betik: doldurma zinciri dört parçadan geçiyor (sözlük → gövde
 * ayrıştırıcı → PDF çevirici → pdfmake) ve tarayıcıdan bakınca hangisinin boş
 * bıraktığı görünmüyor. Burası her adımı ADIM ADIM basar.
 */

import { prisma } from "@/lib/db/prisma"
import {
  belgeMetni,
  elleDoldurulacakAlanlar,
  otomatikDegerler,
  sablonAlanlari,
} from "@/lib/personel/belge-alanlari"
import { govdeDuzMetin, govdePdfIcerigi } from "@/lib/personel/belge-govde"
import { buildTemplateDocPdf } from "@/lib/pdf/personel-pdf"

const arg = (ad: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=")
const bayrak = (ad: string) => process.argv.includes(`--${ad}`)

async function main() {
  const katalog = await prisma.documentTemplate.findMany({
    where: { companyId: null },
    orderBy: { sortOrder: "asc" },
  })
  console.log(`\n=== KATALOG (${katalog.length} şablon) ===`)
  for (const s of katalog) {
    const alanlar = sablonAlanlari(s.body)
    const otomatikSayi = alanlar.filter((a) => a.kaynak !== "ELLE").length
    const elleSayi = alanlar.length - otomatikSayi
    console.log(
      `  ${s.key.padEnd(24)} ${String(otomatikSayi).padStart(2)} otomatik / ${String(elleSayi).padStart(2)} elle  · ${govdeDuzMetin(s.body).length} karakter`,
    )
    // Gövdesi PDF'e çevrilemeyen şablon SESSİZ kalmamalı: boş içerik, basılınca
    // antet + imza olan ama metni olmayan bir belge demektir.
    if (govdePdfIcerigi(s.body).length === 0) console.log("    ⚠️  PDF içeriği BOŞ üretildi")
  }

  const firmaParam = arg("firma")
  if (!firmaParam) {
    console.log("\n(--firma=<id|slug> verilmedi; gerçek veriyle doldurma denenmedi)\n")
    return
  }

  const firma = await prisma.company.findFirst({
    where: { OR: [{ id: firmaParam }, { slug: firmaParam }] },
    select: {
      id: true, name: true, taxNumber: true, taxOffice: true, address: true, city: true,
      district: true, phone: true, email: true, branchName: true, branchNo: true,
    },
  })
  if (!firma) {
    console.error(`❌ Firma bulunamadı: ${firmaParam}`)
    process.exit(1)
  }

  const personel = await prisma.employee.findFirst({
    where: { companyId: firma.id, status: "ACTIVE" },
    select: {
      firstName: true, lastName: true, nationalId: true, phone: true, email: true,
      address: true, position: true, department: true, birthDate: true, hireDate: true,
      terminationDate: true, iban: true, grossSalary: true, netSalary: true,
      annualLeaveDays: true,
    },
  })

  console.log(`\n=== FİRMA: ${firma.name}${firma.branchName ? ` / ${firma.branchName}` : ""} ===`)
  console.log(`  personel: ${personel ? `${personel.firstName} ${personel.lastName}` : "(aktif personel yok)"}`)

  const kaynak = {
    firma,
    personel: personel
      ? {
          ...personel,
          grossSalary: personel.grossSalary?.toString() ?? null,
          netSalary: personel.netSalary?.toString() ?? null,
        }
      : null,
  }

  for (const s of katalog) {
    const otomatik = otomatikDegerler(s.body, kaynak)
    const bosOtomatik = Object.entries(otomatik).filter(([, v]) => !v).map(([k]) => k)
    console.log(`\n  ── ${s.title}`)
    for (const [ad, deger] of Object.entries(otomatik)) {
      console.log(`     ${ad.padEnd(28)} = ${deger || "(BOŞ — kayıtta veri yok)"}`)
    }
    const elle = elleDoldurulacakAlanlar(s.body)
    if (elle.length) console.log(`     elle sorulacak: ${elle.map((a) => `${a.ad}[${a.tip}]`).join(", ")}`)
    if (bosOtomatik.length) console.log(`     ⚠️  kayıtta karşılığı boş: ${bosOtomatik.join(", ")}`)
  }

  if (bayrak("pdf")) {
    const s = katalog.find((k) => k.key === (arg("sablon") ?? "calisma-belgesi")) ?? katalog[0]
    const elle = Object.fromEntries(
      elleDoldurulacakAlanlar(s.body).map((a) => [a.ad, `«${a.ad}»`]),
    )
    const pdf = await buildTemplateDocPdf({
      company: firma,
      employee: personel,
      title: s.title,
      body: govdePdfIcerigi(belgeMetni(s.body, kaynak, elle)),
      signatureLabels: ["Düzenleyen", personel ? "Personel" : "Yetkili"],
    })
    const { writeFileSync } = await import("node:fs")
    const yol = `/tmp/${s.key}.pdf`
    writeFileSync(yol, pdf)
    console.log(`\n✅ PDF üretildi: ${yol} (${(pdf.length / 1024).toFixed(1)} KB)`)
  }
  console.log()
}

main()
  .catch((e) => {
    console.error("HATA:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
