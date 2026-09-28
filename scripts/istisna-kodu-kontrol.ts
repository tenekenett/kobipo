/**
 * KDV İSTİSNA KODU LİSTESİ TAM MI, GİB KABUL EDİYOR MU? — salt okur ölçüm.
 *
 *   npx tsx scripts/istisna-kodu-kontrol.ts [--bayi-vkn=7352344835] [--bosluk]
 *
 * NE ÖLÇER (hiçbir şey yazmaz, GİB'e belge gitmez, Mysoft'ta kayıt kalmaz):
 *   1. Mysoft'un canlı listesi (GET /api/GeneralCard/taxExemptionReason, bayi kimliği)
 *      ↔ lib/integrations/e-invoice/gib-exemption-codes.ts. Mysoft'ta olup bizde
 *      seçilemeyen her kodun NEDENİ yazılmış olmalı; nedensiz kod = eksik liste.
 *   2. Seçicideki HER kod, Kobipo'nun ürettiği biçimde (KDV %0 kalem → ISTISNA tipi)
 *      canlı GİB şematronundan geçiyor mu (InvoiceOutbox/checkSchemaSchematronForInvoiceUBL).
 *      UBL, TEST ortamının taslak XML ucuyla üretilir; canlıda yalnız denetlenir.
 *   3. --bosluk: 200–399 arasında listede OLMAYAN her kodu da dener — GİB'in kabul
 *      ettiği ama bizim (ve Mysoft'un) bilmediği kod var mı. 2026-09-28'de 233 böyle
 *      bulundu (UBL-TR v1.43; Mysoft listesinde yoktu).
 *
 * ÖN KOŞUL: .env.local'da bayi kimliği (MYSOFT_PARTNER_*) ve test kimliği
 * (MYSOFT_USERNAME / MYSOFT_PASSWORD / MYSOFT_API_URL). Bayi kimliği yalnız Kobipo
 * bayiliğindeki mükellefin VKN'siyle denetim yapar (--bayi-vkn, varsayılan Reypo).
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const args = process.argv.slice(2)
const BAYI_VKN = ((args.find((a) => a.startsWith("--bayi-vkn=")) || "").split("=")[1] || "7352344835").replace(/\D/g, "")
const BOSLUK = args.includes("--bosluk")

async function main() {
  const { MysoftEInvoiceProvider } = await import("@/lib/integrations/e-invoice/mysoft-provider")
  const { createPartnerProvider } = await import("@/lib/integrations/e-invoice/partner")
  const { KDV_EXEMPTION_CODES, kdvExemption, kdvExemptionCodeError } = await import(
    "@/lib/integrations/e-invoice/gib-exemption-codes"
  )
  const JSZip = (await import("jszip")).default

  const canli: any = createPartnerProvider()
  if (!canli) throw new Error("Bayi kimliği (MYSOFT_PARTNER_*) yok.")
  const username = process.env.MYSOFT_USERNAME?.trim()
  const password = process.env.MYSOFT_PASSWORD?.trim()
  if (!username || !password) throw new Error("Test kimliği (MYSOFT_USERNAME / MYSOFT_PASSWORD) yok.")
  const test: any = new MysoftEInvoiceProvider({ username, passwordText: password, baseUrl: process.env.MYSOFT_API_URL?.trim() })

  let hata = 0

  // 1) Mysoft listesi ↔ bizim liste
  console.log("\n=== 1) Mysoft canlı listesi ↔ gib-exemption-codes.ts ===")
  const res = await fetch(`${canli.baseUrl}/api/GeneralCard/taxExemptionReason`, {
    headers: { Authorization: `Bearer ${await canli.getToken()}` },
  })
  const liste: any = await res.json()
  if (!liste?.succeed) throw new Error("Mysoft listesi alınamadı: " + liste?.message)
  const mysoft = new Map<string, string>(
    (liste.data as any[]).map((d) => [String(d.taxExemptionReasonCode).trim(), String(d.taxExemptionReasonName).trim()]),
  )
  console.log(`Mysoft: ${mysoft.size} kod · seçici: ${KDV_EXEMPTION_CODES.length} kod`)
  for (const [code, name] of [...mysoft].sort()) {
    if (kdvExemption(code)) continue
    const neden = kdvExemptionCodeError(code)
    const nedensiz = !neden || neden.includes("GİB listesinde yok")
    if (nedensiz) hata++
    console.log(`  ${nedensiz ? "✗ NEDENSİZ" : "·"} ${code} ${name.slice(0, 70)}${nedensiz ? "" : `  → ${neden}`}`)
  }
  const mysoftteYok = KDV_EXEMPTION_CODES.filter((c) => !mysoft.has(c.code)).map((c) => c.code)
  console.log(`Seçicide olup Mysoft listesinde olmayan: ${mysoftteYok.join(", ") || "—"}`)

  // 2) Şematron — taban UBL test ortamında üretilir, kod değiştirilerek canlıda denetlenir
  console.log("\n=== 2) Canlı GİB şematronu (KDV %0 kalem, ISTISNA tipi) ===")
  const sessiz = console.log
  console.log = () => {} // sağlayıcının payload günlükleri
  const taslak: any = await test.sendInvoice({
    invoiceType: "E_ARCHIVE",
    prefix: "TST",
    date: new Date(),
    invoiceNo: "ISTISNA-KONTROL",
    customer: { name: "SON KULLANICI", taxNumber: "11111111111", city: "İSTANBUL", district: "KADIKÖY", address: "TEST ADRES" },
    items: [{ description: "Deneme", quantity: 1, unitPrice: 100, vatRate: 0, productId: "T-1", taxExemptionReasonCode: "350", taxExemptionReason: "Deneme" }],
    draftXmlOnly: true,
  })
  console.log = sessiz
  if (!taslak?.success) throw new Error("Taslak UBL alınamadı: " + taslak?.error)
  const taban = String(taslak.xml)
  const ISARET = ">350</cbc:TaxExemptionReasonCode>"
  if (!taban.includes(ISARET)) throw new Error("Taslak UBL'de istisna kodu bulunamadı.")
  console.log(`Taslak fatura tipi: ${/<cbc:InvoiceTypeCode>([^<]+)</.exec(taban)?.[1]}`)

  const denetle = async (code: string) => {
    const zip = new JSZip()
    zip.file("f.xml", taban.split(ISARET).join(`>${code}</cbc:TaxExemptionReasonCode>`))
    const r = await fetch(`${canli.baseUrl}/api/InvoiceOutbox/checkSchemaSchematronForInvoiceUBL`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await canli.getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceTypeUblString: (await zip.generateAsync({ type: "nodebuffer" })).toString("base64"),
        eDocumentType: "EARSIVFATURA",
        tenantIdentifierNumber: BAYI_VKN,
      }),
    })
    const j: any = await r.json().catch(() => null)
    return { ok: !!j?.succeed && j?.data !== false, mesaj: String(j?.message || `HTTP ${r.status}`).replace(/\s+/g, " ") }
  }

  let gecen = 0
  for (const { code } of KDV_EXEMPTION_CODES) {
    const d = await denetle(code)
    if (d.ok) gecen++
    else {
      hata++
      console.log(`  ✗ ${code} REDDEDİLDİ — ${d.mesaj.slice(0, 250)}`)
    }
  }
  console.log(`Seçicideki ${KDV_EXEMPTION_CODES.length} koddan ${gecen} tanesi GİB şematronundan geçti.`)

  // 3) Boşluk taraması
  if (BOSLUK) {
    console.log("\n=== 3) 200–399 arası listede OLMAYAN kodlar ===")
    for (let n = 200; n <= 399; n++) {
      const code = String(n)
      if (kdvExemption(code)) continue
      const d = await denetle(code)
      // "Geçersiz ... TaxExemptionReasonCode" = GİB bu kodu tanımıyor (beklenen).
      if (d.ok) {
        hata++
        console.log(`  ✗ ${code} GİB kabul ediyor ama seçicide YOK`)
      } else if (!d.mesaj.includes("Geçersiz cbc:TaxExemptionReasonCode")) {
        console.log(`  · ${code} başka nedenle reddedildi — ${d.mesaj.slice(0, 200)}`)
      }
    }
  }

  console.log("\n--------------------------------------------------")
  console.log(hata === 0 ? "SONUÇ: liste tam ve GİB'le uyumlu ✓" : `SONUÇ: ${hata} sorun — yukarıya bakın.`)
  process.exit(hata === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("HATA:", e?.message || e)
  process.exit(1)
})
