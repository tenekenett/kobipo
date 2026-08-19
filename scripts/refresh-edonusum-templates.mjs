/**
 * E-belge XSLT şablonlarını YENİDEN ÜRETİP Mysoft'a aynı adla yükler.
 *
 * Neden gerekli: tasarımcıyla üretilen şablonlar, repodaki taban XSLT'nin
 * (`lib/integrations/e-invoice/sample-templates/*.xslt`) üzerine tema uygulanarak
 * oluşur. Taban XSLT değiştiğinde (ör. kalem notu satırı eklendiğinde) Mysoft'ta
 * KAYITLI tasarım eski haliyle kalır; belgeler eski görselle basılır. Bu betik
 * saklı `options` ile aynı adı yeniden üretip yükler → görsel aynı kalır, taban
 * iyileştirmeleri gelir.
 *
 * Kullanım (kuru çalışma varsayılan — hiçbir şey yüklemez):
 *   node scripts/refresh-edonusum-templates.mjs --company=<companyId>
 *   node scripts/refresh-edonusum-templates.mjs --company=<id> --apply
 *
 * Güvenlik:
 *  - `--apply` verilmedikçe yalnız rapor üretir.
 *  - CANLI ortama bakan firmada `--allow-live` bayrağı şart (yanlışlıkla canlı
 *    belge tasarımını değiştirmeyi zorlaştırmak için).
 *  - Yalnız `options` saklı (tasarımcıyla üretilmiş) şablonlar yenilenir; dışarıdan
 *    yüklenmiş/portal şablonlarının içeriği bizde yok, onlara DOKUNULMAZ.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()

const args = process.argv.slice(2)
const companyId = (args.find((a) => a.startsWith("--company=")) || "").split("=")[1]
const APPLY = args.includes("--apply")
const ALLOW_LIVE = args.includes("--allow-live")

/** Taban XSLT'de olması beklenen imza — yenilemenin işe yaradığının kanıtı. */
const EXPECTED_MARKER = 'select="./cbc:Note"'

async function main() {
  if (!companyId) {
    console.error("Kullanım: node scripts/refresh-edonusum-templates.mjs --company=<companyId> [--apply] [--allow-live]")
    process.exit(1)
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, eDonusumApiUrl: true, isEDonusumEnabled: true },
  })
  if (!company) throw new Error("Firma bulunamadı")

  const isTest = /mytest\.tr/i.test(company.eDonusumApiUrl || "")
  const env = isTest ? "TEST" : "CANLI"
  if (!isTest && !ALLOW_LIVE) {
    throw new Error(`${company.name} CANLI ortama bakıyor. Devam etmek için --allow-live ekleyin.`)
  }

  console.log(`Firma : ${company.name}`)
  console.log(`Ortam : ${company.eDonusumApiUrl || "(varsayılan test)"} → ${env}`)
  console.log(`Mod   : ${APPLY ? "UYGULA (Mysoft'a yüklenecek)" : "kuru çalışma (yalnız rapor)"}\n`)

  // Kullanımda olan şablonlar: firma geneli aktif + seriye atanmış olanlar.
  const templates = await prisma.eInvoiceTemplate.findMany({
    where: { companyId, hidden: false },
    select: { eDocumentType: true, xsltName: true, isActive: true, options: true },
  })
  const seriesMaps = await prisma.eInvoiceSeriesTemplate.findMany({
    where: { companyId },
    select: { eDocumentType: true, prefix: true, xsltName: true },
  })
  const seriesNames = new Set(seriesMaps.map((s) => `${s.eDocumentType}:${s.xsltName}`))

  const inUse = templates.filter(
    (t) => t.isActive || seriesNames.has(`${t.eDocumentType}:${t.xsltName}`),
  )

  const membership = await prisma.userCompany.findFirst({
    where: { companyId, role: "ADMIN" },
    select: { userId: true, role: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  if (!membership) throw new Error("Firmada ADMIN kullanıcı yok")
  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: membership.user.isSuperAdmin || false,
      isBlogEditor: false,
      defaultCompanyId: companyId,
      defaultRole: membership.role,
    },
    secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  })
  const cookie = `next-auth.session-token=${token}`

  const api = async (path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body: json }
  }

  let refreshed = 0
  let skipped = 0

  for (const t of inUse) {
    const usedBy = [
      t.isActive ? "firma geneli aktif" : null,
      ...seriesMaps
        .filter((s) => s.eDocumentType === t.eDocumentType && s.xsltName === t.xsltName)
        .map((s) => `seri ${s.prefix}`),
    ].filter(Boolean)
    const label = `${t.xsltName} (${t.eDocumentType === 1 ? "e-Fatura" : "e-Arşiv"}, ${usedBy.join(" + ")})`

    if (!t.options) {
      console.log(`· ATLANDI  ${label} — dışarıdan yüklenmiş şablon, içeriği bizde yok`)
      skipped++
      continue
    }

    // Kuru çalışmada yalnız üretilebilirliği ve beklenen bloğu doğrula.
    const design = await api("/api/e-donusum/templates/design", {
      companyId,
      eDocumentType: t.eDocumentType,
      options: t.options,
    })
    if (design.status !== 200 || typeof design.body?.content !== "string") {
      console.log(`✗ ÜRETİLEMEDİ ${label} — HTTP ${design.status} ${JSON.stringify(design.body).slice(0, 160)}`)
      continue
    }
    const hasMarker = design.body.content.includes(EXPECTED_MARKER)
    console.log(
      `${hasMarker ? "✓" : "!"} ÜRETİLDİ ${label} — ${design.body.content.length} karakter · kalem notu bloğu: ${hasMarker ? "var" : "YOK"}`,
    )
    if (!hasMarker) {
      console.log("   (taban şablonda beklenen blok yok; yükleme atlandı)")
      skipped++
      continue
    }

    if (!APPLY) {
      refreshed++
      continue
    }

    // Yükleme, arayüzdeki "Yenile" düğmesiyle AYNI ucu kullanır: tek kod yolu,
    // tek davranış — ve taban sürüm damgası (bayatlık takibi) orada düşer.
    const res = await api("/api/e-donusum/templates/refresh", {
      companyId,
      eDocumentType: t.eDocumentType,
      xsltName: t.xsltName,
    })
    if (res.status === 200 && res.body?.success) {
      console.log(`   → yenilendi (aynı ad) · taban sürümü ${res.body.baseVersion}`)
      refreshed++
    } else {
      console.log(`   ✗ yenilenemedi — HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
    }
  }

  console.log(
    `\n${APPLY ? "Yenilenen" : "Yenilenebilir"}: ${refreshed} · atlanan: ${skipped} · kullanımdaki toplam: ${inUse.length}`,
  )
  if (!APPLY && refreshed > 0) console.log("Uygulamak için aynı komutu --apply ile çalıştırın.")
}

main()
  .catch((e) => {
    console.error("\nHATA:", e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
