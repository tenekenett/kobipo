require("dotenv").config({ path: ".env.local" })
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

/**
 * Adı ÜRÜN ADI değil de STOK KODU görünen ürün kartlarını listeler.
 *
 * Neden: gelen e-faturadan alış faturasına dönüştürme akışında, kalem açıklaması
 * ürün kartının adı olarak kullanılıyor. Bazı göndericiler stok kodunu hem
 * "Satıcı Kodu"na hem "Stok Adı"na yazdığından (gerçek ad "Stok Açıklaması"nda
 * kalıyor), bu kartlar "153 43KLM FIN 0120" gibi kodla açılmış olabiliyordu.
 * Eşleme düzeltildi (mysoft-provider.ts) ama ÖNCEDEN açılmış kartlar öyle kaldı —
 * bu script onları bulur. Hiçbir şeyi DEĞİŞTİRMEZ, yalnızca raporlar.
 *
 * Kullanım:
 *   node scripts/audit-product-names.js            # tüm firmalar
 *   node scripts/audit-product-names.js <firma>    # tek firma
 */

const norm = (v) => String(v || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("tr")

/**
 * Ad "kod gibi mi" görünüyor?
 *
 * Ayırt edici işaret, rakam oranı DEĞİL — gerçek ürün adları da bol rakam içerir
 * ("CASTROL 5W30 20 LT.", "LB 13145/3 FİLTRE"). Asıl fark, adın anlamlı bir KELİME
 * içerip içermemesi: stok kodlarında harf dizileri kısa kısaltmalardır
 * ("153 43KLM FIN 0120" → KLM, FIN). Bu yüzden ölçüt: en uzun harf dizisi ≤ 4 ve
 * içinde rakam var.
 */
function looksLikeCode(name) {
  const s = String(name || "").trim()
  if (!s) return false
  if (!/\d/.test(s)) return false
  const runs = s.match(/\p{L}+/gu) || []
  const longestWord = runs.reduce((m, r) => Math.max(m, r.length), 0)
  return longestWord <= 4
}

async function main() {
  const ref = process.argv[2]

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  })
  const targets = ref
    ? companies.filter(
        (c) =>
          c.id === ref ||
          c.slug === ref ||
          (c.name || "").toLowerCase().includes(ref.toLowerCase()),
      )
    : companies
  if (targets.length === 0) return console.log("Firma bulunamadı:", ref)

  let grandTotal = 0

  for (const company of targets) {
    const products = await prisma.product.findMany({
      where: { companyId: company.id },
      select: {
        id: true, name: true, code: true, isService: true,
        purchasePrice: true, salePrice: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    })
    if (products.length === 0) continue

    // Aranan hata imzası: gönderici stok KODUNU ürün ADI olarak da göndermiş.
    // Bu yüzden yalnızca KODU OLAN kartlara bakıyoruz — kodu olmayan bir kart bu
    // yoldan gelmiş olamaz (ve "CASTROL 5W30 20 LT." gibi meşru adlar elenir).
    const withCode = products.filter((p) => p.code)

    // 1) Adı kodunun birebir aynısı VE kod gibi duruyor — en kesin bulgu.
    //    ("kahve1"/"kahve1" gibi kullanıcının bilerek aynı yazdığı kartlar elenir.)
    const nameEqualsCode = withCode.filter(
      (p) => norm(p.name) === norm(p.code) && looksLikeCode(p.name),
    )
    // 2) Kodu var, adı farklı ama ad yine de kod gibi duruyor — gözle doğrulanmalı.
    const nameLooksLikeCode = withCode.filter(
      (p) => !nameEqualsCode.includes(p) && looksLikeCode(p.name),
    )

    if (nameEqualsCode.length === 0 && nameLooksLikeCode.length === 0) continue

    console.log(`\n${"=".repeat(78)}`)
    console.log(`${company.name}  (${company.slug || company.id})  · ${products.length} ürün kartı`)

    if (nameEqualsCode.length > 0) {
      console.log(`\n  KESİN — adı kodunun aynısı (${nameEqualsCode.length}):`)
      nameEqualsCode.forEach((p) =>
        console.log(
          `    ${p.createdAt.toISOString().slice(0, 10)}  ad="${p.name}"  kod="${p.code}"` +
            `${p.isService ? "  [hizmet]" : ""}`,
        ),
      )
    }
    if (nameLooksLikeCode.length > 0) {
      console.log(`\n  OLASI — adı stok kodu gibi duruyor (${nameLooksLikeCode.length}):`)
      nameLooksLikeCode.forEach((p) =>
        console.log(
          `    ${p.createdAt.toISOString().slice(0, 10)}  ad="${p.name}"  kod="${p.code || "-"}"` +
            `${p.isService ? "  [hizmet]" : ""}`,
        ),
      )
    }
    grandTotal += nameEqualsCode.length + nameLooksLikeCode.length
  }

  console.log(`\n${"=".repeat(78)}`)
  if (grandTotal === 0) {
    console.log("Şüpheli ürün kartı bulunamadı.")
  } else {
    console.log(
      `Toplam ${grandTotal} şüpheli kart. Bu script hiçbir kaydı değiştirmez —\n` +
        "doğru adı gelen faturadan görmek için:\n" +
        "  node scripts/inspect-incoming-lines.js <firma> <ETTN>\n" +
        "sonra kartı Stok ekranından elle düzeltin.",
    )
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect())
