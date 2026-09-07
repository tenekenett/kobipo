/**
 * ABONELİK UYARISI TEST MAİLİ — bağlantı düzeltmesini gerçek bir posta kutusunda doğrular.
 *
 *   npx tsx scripts/test-abonelik-maili.ts <e-posta> [--dry]
 *
 * NEDEN: 2026-09-07'de giden uyarı e-postasındaki link marka domaini yerine Vercel'in
 * DAĞITIMA ÖZGÜ adresiyle (kobipo-…-projects.vercel.app) çıktı. Sebebi cron isteğinin
 * `host` başlığıydı (bkz. lib/utils/base-url.ts). Bu betik cron isteğini birebir taklit
 * eder — GET, `origin` YOK, host = dağıtım adresi — ve linki `resolveBaseUrl` ile üretip
 * gerçek şablonla (`subscriptionNoticeEmail`) yollar. Yani şablonun kopyası değil,
 * üretimde çalışan kodun ta kendisi sınanır.
 *
 * Yerel `.env` NEXT_PUBLIC_APP_URL/NEXTAUTH_URL'i localhost gösterir; test mailinde
 * tıklanamaz bir localhost linki işe yaramayacağı için bu üç değişken ÜRETİMDEKİ gibi
 * (boş/kanonik) kurulur. Gönderim Resend'in gerçek ucundan yapılır.
 *
 * `--dry` verilirse e-posta GÖNDERİLMEZ, yalnız çözülen adres ve konu basılır.
 */

import { config } from "dotenv"

// Sıra önemli: .env.local önce (dotenv var olan değeri EZMEZ), sonra .env.
config({ path: ".env.local" })
config({ path: ".env" })

const to = process.argv[2]
const dry = process.argv.includes("--dry")

if (!to || !to.includes("@")) {
  console.error("Kullanım: npx tsx scripts/test-abonelik-maili.ts <e-posta> [--dry]")
  process.exit(1)
}

// Cron ortamı: üretimde bu üç değişken ya kanonik adresi gösterir ya hiç yoktur.
// Yereldeki localhost değerleri testi anlamsız kılardı, temizleniyor.
delete process.env.NEXT_PUBLIC_APP_URL
delete process.env.NEXTAUTH_URL
delete process.env.AUTH_URL

/** Vercel Cron'un uygulamaya attığı isteğin başlıkları — `origin` YOK, host dağıtıma özgü. */
const CRON_HOST = "kobipo-ri4t58v21-tenekenets-projects.vercel.app"
const cronRequest = new Request(`https://${CRON_HOST}/api/billing/cron/daily`, {
  method: "GET",
  headers: { host: CRON_HOST, "x-forwarded-proto": "https" },
})

// Ekran görüntüsündeki e-postanın verisi — link birebir karşılaştırılabilsin diye.
const COMPANY_NAME =
  "EREN FORKLİFT PNÖMATİK HİDROLİK VİNÇ MAKİNA GIDA BİLİŞİM SANAYİ VE TİCARET LİMİTED ŞİRKETİ"
const COMPANY_SLUG =
  "eren-forklift-pnomatik-hidrolik-vinc-makina-gida-bilisim-sanayi-ve-ticaret-limit-2"

async function main() {
  // Dinamik import ŞART: lib/email/resend.ts, Resend istemcisini modül yüklenirken
  // RESEND_API_KEY'den kurar. Statik import dotenv'den ÖNCE çalışır ve key'siz kalırdı.
  const { resolveBaseUrl } = await import("../lib/utils/base-url")
  const { subscriptionNoticeEmail } = await import("../lib/email/templates")
  const { sendEmail, EMAIL_FROM } = await import("../lib/email/resend")

  const baseUrl = resolveBaseUrl(cronRequest)
  const renewUrl = `${baseUrl}/ayarlar/abonelik?company=${encodeURIComponent(COMPANY_SLUG)}`

  const { subject, html } = subscriptionNoticeEmail({
    kind: "expiring",
    daysLeft: 7,
    endsAt: new Date("2026-09-13T00:00:00+03:00"),
    locksAt: new Date("2026-09-20T00:00:00+03:00"),
    companyName: COMPANY_NAME,
    renewUrl,
    userName: "RIFAT EREN",
  })

  console.log("cron host   :", CRON_HOST)
  console.log("ÖNCE (hata) :", `https://${CRON_HOST}/ayarlar/abonelik?company=…`)
  console.log("SONRA       :", renewUrl)
  console.log("gönderen    :", EMAIL_FROM)
  console.log("alıcı       :", to)
  console.log("konu        :", `[TEST] ${subject}`)

  if (dry) {
    console.log("\n--dry verildi, e-posta gönderilmedi.")
    return
  }

  // Konuya [TEST] eklenir: gövde üretimdekinin AYNISI olmalı (sınanan o), ama kutuya
  // düşen kişi bunu gerçek bir abonelik uyarısı sanmamalı.
  const result = await sendEmail({ to, subject: `[TEST] ${subject}`, html })
  console.log("\nsonuç       :", result)
  if (!result.ok) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
