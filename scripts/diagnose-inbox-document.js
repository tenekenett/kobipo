require("dotenv").config({ path: ".env.local" })
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const { createDecipheriv, createHash } = require("crypto")

const prisma = new PrismaClient()

/**
 * "İlgili kayıt mongoda bulunamadı" teşhisi.
 *
 * Gelen e-faturanın belge görüntüsü (PDF/HTML/UBL) alınamıyor. Bu script, aynı
 * ETTN için Mysoft'un TÜM gelen-belge uçlarını × tenant varyantlarını deneyip
 * hangisinin veri döndürdüğünü tablo hâlinde yazar. Amaç, hatanın
 *   (a) yanlış tenant   (b) yanlış uç      (c) Mysoft'ta gerçekten belge yok
 * hangisi olduğunu tahmin etmeden görmek.
 *
 * Kullanım:
 *   node scripts/diagnose-inbox-document.js <firma> [adet]
 *   QUICK=1 node scripts/diagnose-inbox-document.js <firma> 12   # yalnız PDF ucu, hızlı tarama
 *
 * ÜRETİM HESABI: Firmaların Mysoft şifresi NEXTAUTH_SECRET ile şifrelenir. Üretimde
 * kaydedilmiş bir firmayı lokalden sorgulamak isterseniz şifre çözülemez ("Unsupported
 * state or unable to authenticate data"). İki çıkış yolu var:
 *   1) Kimliği doğrudan verin (şifre çözme atlanır):
 *        MYSOFT_USER=... MYSOFT_PASS=... MYSOFT_URL=https://edocumentapi.mysoft.com.tr \
 *          node scripts/diagnose-inbox-document.js <firma> 3
 *   2) Ya da scripti üretim ortamında (doğru NEXTAUTH_SECRET ile) çalıştırın.
 */

function decryptSecret(payload) {
  if (!payload) return ""
  const [ivHex, tagHex, dataHex] = String(payload).split(":")
  if (!ivHex || !tagHex || !dataHex) return ""
  const source = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!source) throw new Error("NEXTAUTH_SECRET/AUTH_SECRET yok — şifre çözülemez")
  const key = createHash("sha256").update(source).digest()
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8")
}

// JWT payload'ından VKN/TCKN görünümlü ilk değeri çıkarır (provider ile aynı fikir).
function vknFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"))
    const hits = []
    const walk = (v) => {
      if (typeof v === "string" && /^\d{10,11}$/.test(v) && !/^(\d)\1+$/.test(v)) hits.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === "object") Object.values(v).forEach(walk)
    }
    walk(payload)
    return [...new Set(hits)]
  } catch {
    return []
  }
}

// QUICK=1 → yalnızca PDF ucu + tenant'sız çağrı (çok sayıda faturayı hızlı taramak için).
const QUICK = process.env.QUICK === "1"

const ENDPOINTS = QUICK
  ? [["PDF", "getInvoiceInboxPdfAsZip"]]
  : [
  ["PDF", "getInvoiceInboxPdfAsZip"],
  ["HTML", "getInvoiceInboxHTMLAsZip"],
  ["UBLXML", "getInvoiceInboxUBLXMLAsZip"],
  ["UBL+ENV", "getInvoiceInboxUBLXMLWithEnvelopeInfoAsZip"],
  ["MODEL", "getInvoiceInboxModel"],
  ["ENVMODEL", "getInvoiceInboxWithEnvelopeModel"],
  ["STATUS", "getInvoiceInboxStatus"],
]

async function main() {
  const ref = process.argv[2]
  const limit = Number(process.argv[3]) || 3

  const companies = await prisma.company.findMany({
    select: {
      id: true, name: true, slug: true, taxNumber: true,
      eDonusumApiUsername: true, eDonusumApiPassword: true, eDonusumApiUrl: true,
      eDonusumTenantVkn: true, eDonusumOnboardingStatus: true,
    },
  })
  if (!ref) {
    console.log("Firma belirtin. Mevcut:")
    companies.forEach((c) => console.log(`  ${c.slug || c.id}  ${c.name}`))
    return
  }
  const low = ref.toLowerCase()
  // Önce birebir id/slug, sonra ada göre — yoksa "reypo" araması "reypo-2"yi yakalar.
  const company =
    companies.find((c) => c.id === ref || c.slug === ref) ||
    companies.find((c) => (c.name || "").toLowerCase().includes(low))
  if (!company) return console.log("Firma bulunamadı:", ref)

  // Uygulamadaki resolveCompanyEInvoiceProvider ile aynı seçim: firmanın kendi
  // kimliği varsa o, yoksa bayi (master) kimliği + firma VKN'si tenant olarak.
  let mode, username, password, baseUrl
  if (process.env.MYSOFT_USER && process.env.MYSOFT_PASS) {
    // Elle verilen kimlik — üretimde kayıtlı şifre lokalde çözülemediğinde kullanılır.
    mode = "env"
    username = process.env.MYSOFT_USER.trim()
    password = process.env.MYSOFT_PASS
    baseUrl =
      process.env.MYSOFT_URL?.trim() || company.eDonusumApiUrl || "https://efatura.mysoft.com.tr"
  } else if (company.eDonusumApiUsername && company.eDonusumApiPassword) {
    mode = "manual"
    username = company.eDonusumApiUsername
    try {
      password = decryptSecret(company.eDonusumApiPassword)
    } catch {
      // Şifre başka bir NEXTAUTH_SECRET ile (ör. üretimde) şifrelenmiş.
      console.log(
        `\n${company.name}: kayıtlı Mysoft şifresi bu ortamın NEXTAUTH_SECRET'i ile çözülemiyor` +
          " (büyük ihtimalle üretimde kaydedilmiş).\nKimliği elle vererek deneyin:\n" +
          `  MYSOFT_USER='${company.eDonusumApiUsername}' MYSOFT_PASS='...' ` +
          `MYSOFT_URL='${company.eDonusumApiUrl || "https://edocumentapi.mysoft.com.tr"}' \\\n` +
          `    node scripts/diagnose-inbox-document.js ${company.slug || company.id} 3`,
      )
      return
    }
    baseUrl = company.eDonusumApiUrl || "https://efatura.mysoft.com.tr"
  } else {
    mode = "bayi"
    username = process.env.MYSOFT_PARTNER_USERNAME?.trim()
    password = process.env.MYSOFT_PARTNER_PASSWORD?.trim()
    baseUrl = process.env.MYSOFT_PARTNER_API_URL?.trim() || "https://efatura.mysoft.com.tr"
    if (!username || !password) return console.log("Bayi kimliği (MYSOFT_PARTNER_*) env'de yok.")
  }
  baseUrl = baseUrl.replace(/\/$/, "")

  console.log(`\nFirma : ${company.name} (${company.slug || company.id})`)
  console.log(`Mod   : ${mode}  (kullanıcı: ${username})`)
  console.log(`Base  : ${baseUrl}`)
  console.log(`VKN   : firma=${company.taxNumber} tenantVkn=${company.eDonusumTenantVkn || "-"} onboarding=${company.eDonusumOnboardingStatus || "-"}`)

  const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, grant_type: "password" }),
  })
  const tokenData = await tokenRes.json().catch(() => ({}))
  if (!tokenData.access_token) {
    return console.log("Token alınamadı:", tokenData.error_description || tokenData.error || tokenRes.status)
  }
  const token = tokenData.access_token
  console.log(`Token : OK — JWT içindeki VKN adayları: ${vknFromToken(token).join(", ") || "(yok)"}`)

  const tenants = [
    ["(yok)", ""],
    ["firmaVKN", company.taxNumber || ""],
    ["tenantVkn", company.eDonusumTenantVkn || ""],
    ...vknFromToken(token).map((v) => [`jwt:${v}`, v]),
  ]
    .filter(([, v], i, arr) => (v === "" ? i === 0 : arr.findIndex(([, x]) => x === v) === i))
    .slice(0, QUICK ? 1 : undefined)

  // Liste çağrısı da tenant'a duyarlı mı? (Uygulama listeyi tenant PARAMETRESİZ çeker.)
  for (const [tName, tVal] of tenants) {
    const url = new URL(`${baseUrl}/api/InvoiceInbox/getInvoiceInboxWithHeaderInfoListForPeriod`)
    if (tVal) url.searchParams.set("tenantIdentifierNumber", tVal)
    const end = new Date()
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: new Date(end.getTime() - 30 * 864e5).toISOString(),
        endDate: end.toISOString(),
      }),
    })
    const body = await res.json().catch(() => null)
    const n = Array.isArray(body?.data) ? body.data.length : null
    console.log(
      `Liste : tenant ${String(tName).padEnd(14)} → ${
        body?.succeed === false ? `HATA: ${body.message}` : `${n ?? "?"} kayıt`
      }`,
    )
  }

  const invoices = await prisma.incomingInvoice.findMany({
    where: { companyId: company.id },
    select: { uuid: true, invoiceNo: true, docDate: true, syncedAt: true },
    orderBy: { docDate: "desc" },
    take: limit,
  })
  console.log(`\n${invoices.length} fatura denenecek, ${tenants.length} tenant varyantı × ${ENDPOINTS.length} uç\n`)

  const call = async (path, uuid, tenant) => {
    const url = new URL(`${baseUrl}/api/InvoiceInbox/${path}`)
    url.searchParams.set("invoiceETTN", uuid)
    if (tenant) url.searchParams.set("tenantIdentifierNumber", tenant)
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      })
      const body = await res.json().catch(() => null)
      if (!body) return `HTTP ${res.status} (JSON değil)`
      if (body.succeed === false) return `HATA: ${body.message || "(mesajsız)"}`
      const data = body.data
      if (data === null || data === undefined || data === "") return "BOŞ (succeed ama data yok)"
      const size = typeof data === "string" ? `${Math.round(data.length / 1.37)}B` : "obj"
      return `OK ${size}`
    } catch (e) {
      return `İSTİSNA: ${e.message}`
    }
  }

  for (const inv of invoices) {
    console.log(`── ${inv.invoiceNo || "(no yok)"}  ETTN ${inv.uuid}  tarih ${inv.docDate?.toISOString().slice(0, 10)}`)
    for (const [tName, tVal] of tenants) {
      const cells = []
      for (const [label, path] of ENDPOINTS) {
        cells.push(`${label}=${await call(path, inv.uuid, tVal)}`)
      }
      console.log(`   tenant ${tName.padEnd(14)} ${cells.join("  |  ")}`)
    }
    console.log("")
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect())
