/**
 * ŞUBE ADRESİ — belgeye gerçekten yazılıyor mu?
 *
 *   npx tsx scripts/sube-adresi-kontrol.ts                        → OFFLINE payload testi
 *   npx tsx scripts/sube-adresi-kontrol.ts --canli --test         → Mysoft TEST ortamında UBL ölçümü
 *   npx tsx scripts/sube-adresi-kontrol.ts --canli --firma=<id>   → firmanın kendi hesabında ölçüm
 *
 * NEDEN İKİ MOD
 * Payload'a alan koymak, belgede o alanın ÇIKTIĞI anlamına gelmiyor: Mysoft sevk
 * adresi alanlarını (delivery*) kabul edip UBL'e hiç yazmıyor (2026-08-05 ölçümü,
 * bkz. mysoft-provider.ts). Bu yüzden:
 *
 *  1) OFFLINE mod — ağ yok, veritabanı yok. Gerçek provider'ı sahte `fetch` ile
 *     çalıştırıp `supplierAgentAccount` alanının payload'a doğru girdiğini doğrular.
 *     Regresyon testidir; her makinede çalışır.
 *  2) CANLI mod — firmanın kendi Mysoft kimliğiyle "Fatura Önizleme - XML" ucunu
 *     çağırır ve dönen UBL'de `cac:AgentParty` + şube adresi var mı diye bakar.
 *     Önizlemedir: GİB'e belge GİTMEZ, Mysoft'ta kayıt bırakmaz.
 *
 * CANLI mod ÖN KOŞULU: Mysoft şifreleri canlının anahtarıyla şifreli —
 * `npm run vercel:env:pull` ile .env.local indirilmiş olmalı.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { resolveBranchParty } from "@/lib/integrations/e-invoice/branch-party"

const args = process.argv.slice(2)
const CANLI = args.includes("--canli")
const TEST_ORTAMI = args.includes("--test")
const FIRMA = (args.find((a) => a.startsWith("--firma=")) || "").split("=")[1] || ""

/** Ana firmadan ayırt edilebilsin diye belirgin değerler. */
const SUBE = {
  name: "ÖRNEK GIDA SANAYİ A.Ş.",
  branchNo: "3",
  address: "BAĞDAT CAD. NO:90",
  city: "İSTANBUL",
  district: "KADIKÖY",
  phone: "0216 111 22 33",
  email: "kadikoy@ornek.com",
}

const ORNEK_KALEM = [
  { description: "Deneme Ürün", quantity: 1, unitPrice: 100, vatRate: 20, productId: "URN-1" },
]

let gecen = 0
let kalan = 0
const kontrol = (ad: string, ok: boolean, detay?: string) => {
  ok ? gecen++ : kalan++
  console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"}  ${ad}${detay ? `  — ${detay}` : ""}`)
}

/* ------------------------------------------------------------------ OFFLINE */

async function offline() {
  console.log("\n=== OFFLINE: payload testi (ağ/veritabanı yok) ===\n")

  const yakala = async (branch: any) => {
    let payload: any = null
    const gercekFetch = globalThis.fetch
    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url)
      if (u.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "TEST_TOKEN", token_type: "bearer", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      if (u.includes("getInvoiceOutboxDraftPdfAsZip")) {
        payload = JSON.parse(String(init?.body ?? "{}"))
        return new Response(JSON.stringify({ succeed: false, message: "TEST-CAPTURE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error("Beklenmeyen ağ çağrısı (testte olmamalı): " + u)
    }) as any

    const provider = new MysoftEInvoiceProvider({
      username: "test",
      passwordText: "test",
      baseUrl: "https://edocumentapi.mytest.tr",
    })
    await provider.sendInvoice({
      invoiceType: "E_ARCHIVE",
      draftPdfOnly: true,
      prefix: "TST", // açık prefix → numaratör/örnek payload fetch'leri atlanır
      date: new Date(),
      branch,
      customer: { name: "TEST MÜŞTERİ A.Ş.", taxNumber: "1234567890", city: "İSTANBUL" },
      items: ORNEK_KALEM,
    })
    globalThis.fetch = gercekFetch
    return payload
  }

  const ileSube = await yakala(SUBE)
  if (!ileSube) {
    console.error("✗ HATA: payload yakalanamadı (draftPdfOnly yolu çalışmadı).")
    process.exit(1)
  }
  const agent = ileSube.supplierAgentAccount
  console.log("Yakalanan supplierAgentAccount:")
  console.log(JSON.stringify(agent, null, 2), "\n")

  kontrol("şube verilince supplierAgentAccount gönderiliyor", Boolean(agent))
  kontrol("ünvan yazılıyor", agent?.agentAccountName === SUBE.name, agent?.agentAccountName)
  kontrol(
    "şube no gönderiliyor (Mysoft zorunlu tutuyor, belgede SUBENO)",
    agent?.agentNumber === SUBE.branchNo,
    agent?.agentNumber,
  )
  kontrol("şubenin adresi streetName'e giriyor", agent?.streetName === SUBE.address, agent?.streetName)
  kontrol("il GeneralLookupNameModel biçiminde", agent?.city?.name === SUBE.city, JSON.stringify(agent?.city))
  kontrol(
    "ilçe firmadan gidiyor",
    agent?.citySubdivision === SUBE.district,
    agent?.citySubdivision,
  )
  kontrol("ülke yazılıyor", agent?.country?.name === "TÜRKİYE", JSON.stringify(agent?.country))
  kontrol("telefon/e-posta taşınıyor", agent?.telephone1 === SUBE.phone && agent?.email1 === SUBE.email)

  const ilcesiz = await yakala({ ...SUBE, district: "" })
  kontrol(
    "ilçe boşsa il'e düşer (UBL-TR zorunlu, boş kalırsa belge reddedilir)",
    ilcesiz?.supplierAgentAccount?.citySubdivision === SUBE.city,
    ilcesiz?.supplierAgentAccount?.citySubdivision,
  )

  const noSuz = await yakala({ ...SUBE, branchNo: "" })
  kontrol(
    "şube no boşsa '1' gönderiliyor (blok hiç üretilmesin diye)",
    noSuz?.supplierAgentAccount?.agentNumber === "1",
    noSuz?.supplierAgentAccount?.agentNumber,
  )

  const subesiz = await yakala(undefined)
  kontrol(
    "şube yoksa alan HİÇ gönderilmiyor (ana firma belgesi değişmez)",
    subesiz?.supplierAgentAccount === undefined,
  )

  console.log("\n--- kural (branch-party.ts) ---")
  kontrol(
    "ana firma → şube bloğu yok",
    resolveBranchParty({ name: "X", address: "A", city: "İzmir", parentCompanyId: null }) === null,
  )
  kontrol(
    "adresi ana firmayla aynı şube → blok yok",
    resolveBranchParty({
      name: "X",
      address: "A Cad. 1",
      city: "İzmir",
      parentCompanyId: "p",
      parentCompany: { address: "a cad.  1", city: "İZMİR" },
    }) === null,
  )
  kontrol(
    "farklı adresli şube → blok var",
    resolveBranchParty({
      name: "X",
      address: "B Cad. 2",
      city: "İzmir",
      parentCompanyId: "p",
      parentCompany: { address: "A Cad. 1", city: "İzmir" },
    }) !== null,
  )
}

/* -------------------------------------------------------------------- CANLI */

/**
 * Ölçümü yapacak provider + ölçülecek şube tarafı.
 *
 *  --test          → env'deki MYSOFT_* (test ortamı) kimliği, örnek şube ile.
 *  --firma=<id>    → o firmanın kendi Mysoft kimliği; firma şubeyse KENDİ adresiyle.
 */
async function olcumHedefi(): Promise<{ provider: any; branch: any; baslik: string; prefix?: string; tenantVkn?: string }> {
  if (TEST_ORTAMI) {
    const username = process.env.MYSOFT_USERNAME?.trim()
    const password = process.env.MYSOFT_PASSWORD?.trim()
    const baseUrl = process.env.MYSOFT_API_URL?.trim()
    if (!username || !password) {
      console.error("MYSOFT_USERNAME / MYSOFT_PASSWORD yok — test ortamı ölçümü yapılamaz.")
      process.exit(1)
    }
    return {
      provider: new MysoftEInvoiceProvider({ username, passwordText: password, baseUrl }),
      branch: SUBE,
      baslik: `TEST ORTAMI (${baseUrl})`,
    }
  }

  const { prisma } = await import("@/lib/db/prisma")
  const {
    COMPANY_PROVIDER_SELECT,
    resolveCompanyEInvoiceProvider,
  } = await import("@/lib/integrations/e-invoice/company-provider")

  if (!FIRMA) {
    console.error("--firma=<companyId> (ya da --test) gerekli.")
    process.exit(1)
  }

  const company = await prisma.company.findUnique({
    where: { id: FIRMA },
    select: {
      ...COMPANY_PROVIDER_SELECT,
      name: true,
      address: true,
      city: true,
      phone: true,
      email: true,
      parentCompanyId: true,
      eFaturaPrefix: true,
      eArchivePrefix: true,
      parentCompany: { select: { taxNumber: true, address: true, city: true } },
    },
  })
  if (!company) {
    console.error("Firma bulunamadı: " + FIRMA)
    process.exit(1)
  }

  const resolved = resolveCompanyEInvoiceProvider(company as any)
  if (!resolved.ok) {
    console.error("Sağlayıcı kurulamadı: " + resolved.error)
    process.exit(1)
  }

  // Firma gerçekten şubeyse kendi bilgisiyle, değilse belirgin bir örnek şubeyle
  // ölçeriz — ölçülen şey Mysoft'un alanı UBL'e yazıp yazmadığıdır.
  const gercek = resolveBranchParty(company as any)
  console.log(gercek ? "Şube bilgisi firmadan okundu." : "Firma şube değil — örnek şube ile ölçülüyor.")
  await prisma.$disconnect()
  return {
    provider: resolved.provider,
    branch: gercek ?? SUBE,
    baslik: `${company.name} [${resolved.mode}]`,
    prefix: company.eArchivePrefix || undefined,
    tenantVkn: resolved.tenantVkn || undefined,
  }
}

async function canli() {
  const { provider, branch, baslik, prefix, tenantVkn } = await olcumHedefi()
  console.log(`\n=== CANLI ÖLÇÜM: ${baslik} ===`)
  console.log(JSON.stringify(branch, null, 2), "\n")

  const xmlAl = async (withBranch: boolean) => {
    const r: any = await provider.sendInvoice({
      invoiceType: "E_ARCHIVE",
      draftXmlOnly: true,
      prefix,
      tenantIdentifierNumber: tenantVkn,
      date: new Date(),
      invoiceNo: "SUBE-TEST",
      branch: withBranch ? branch : undefined,
      customer: {
        name: "SON KULLANICI",
        taxNumber: "11111111111",
        city: "İSTANBUL",
        district: "KADIKÖY",
        address: "TEST ADRES",
      },
      items: ORNEK_KALEM,
    })
    if (!r?.success) {
      console.error(`Taslak XML alınamadı (branch=${withBranch}): ${r?.error}`)
      process.exit(1)
    }
    return String(r.xml)
  }

  const ile = await xmlAl(true)
  const siz = await xmlAl(false)

  const agentBlok = /<cac:AgentParty>[\s\S]*?<\/cac:AgentParty>/.exec(ile)?.[0] || ""
  kontrol("UBL'de cac:AgentParty oluştu", Boolean(agentBlok))
  kontrol("şube ünvanı belgede", ile.includes(branch.name))
  kontrol("şube adresi belgede", Boolean(branch.address) && ile.includes(branch.address))
  kontrol("şube ili belgede", Boolean(agentBlok) && agentBlok.includes(branch.city))
  kontrol(
    "şube ilçesi belgede",
    Boolean(agentBlok) && agentBlok.includes(branch.district || branch.city),
    branch.district || `(ilçe yok → ${branch.city})`,
  )
  kontrol(
    "şube no SUBENO olarak belgede",
    new RegExp(`schemeID="SUBENO">${branch.branchNo || "1"}<`).test(agentBlok),
    branch.branchNo || "1",
  )
  kontrol(
    "şubesiz belgede AgentParty YOK (fark gerçekten bu alandan geliyor)",
    !/<cac:AgentParty>/.test(siz),
  )
  console.log(`\n  XML uzunluğu: şubeli ${ile.length} · şubesiz ${siz.length}`)
  if (agentBlok) {
    console.log("\n--- belgeye yazılan AgentParty ---")
    console.log(agentBlok.replace(/></g, ">\n<"))
  } else {
    console.log(
      "\n  UYARI: Mysoft alanı kabul etti ama UBL'e YAZMADI. Sevk adresindeki (delivery*)\n" +
        "  durumun aynısı — bu durumda çözüm Mysoft'a bildirilmeli ya da belge UBL'i\n" +
        "  invoiceOutboxWithUblXml ile bizim üretmemiz gerekir.",
    )
  }
}

async function main() {
  if (CANLI) await canli()
  else await offline()

  console.log("\n--------------------------------------------------")
  console.log(
    kalan === 0
      ? `SONUÇ: ${gecen}/${gecen} kontrol GEÇTİ ✓`
      : `SONUÇ: ${gecen}/${gecen + kalan} geçti — ${kalan} BAŞARISIZ.`,
  )
  process.exit(kalan === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("HATA:", e?.stack || e?.message || e)
  process.exit(1)
})
