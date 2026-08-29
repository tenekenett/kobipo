/**
 * KAYITLI BELGE TASARIMLARINI TOPLUCA TAZELER — tüm firmalar için, tek koşumda.
 *
 *   npx tsx scripts/sablonlari-tazele.ts                    → yalnız rapor (kuru çalışma)
 *   npx tsx scripts/sablonlari-tazele.ts --uygula --canli   → Mysoft'a yükler
 *   npx tsx scripts/sablonlari-tazele.ts --firma=<companyId>
 *
 * ÖN KOŞUL: canlı firmalara dokunacaksa CANLI ortam değişkenleri gerekir —
 * `npm run vercel:env:pull` (.env.local'e indirir). Aksi halde Mysoft şifreleri
 * çözülemez ve betik her firmayı "sağlayıcı kurulamadı" diye atlar.
 *
 * NEDEN GEREKLİ
 * Kobipo tasarımları repodaki taban XSLT'nin üzerine tema uygulanarak üretilir, ama
 * belgeyi Mysoft KENDİ kayıtlı kopyasıyla basar. Taban iyileştiğinde (banka/IBAN
 * notunun açıklama kutusuna alınması gibi) o kopya eski kalır.
 *
 * Bunu normalde kullanıcı DEĞİL, gönderim yolundaki otomatik tazeleme halleder
 * ([[lib/integrations/e-invoice/template-refresh.ts]]) ve o mekanizma canlıda
 * ÇALIŞIYOR — ölçüldü: 2026-08-22'deki taban değişikliğinden sonra e-Fatura
 * gönderen firmaların e-Fatura şablonu gönderim gününde tazelenmiş.
 *
 * Ama tazeleme TEMBELDİR: yalnız o an gönderilen belge tipinin şablonuna dokunur.
 * Firmanın e-Arşiv şablonu, ilk e-Arşiv gönderimine kadar bayat kalır; hiç fatura
 * göndermeyen firmada ise hiçbir şey tetiklenmez. 2026-08-29 ölçümünde kullanımdaki
 * 20 şablonun 10'u bu yüzden bayattı.
 *
 * Bu betik o beklemeyi ortadan kaldırır: bayat olan her şablonu şimdi tazeler,
 * kimseye "şablonunu yenile" dedirtmeden.
 *
 * KAPSAM
 *  - Yalnız KULLANIMDAKİ şablonlar: firma geneli aktif olan ya da bir seriye
 *    (prefix) atanmış olanlar. Kullanılmayanı yüklemek boşuna Mysoft yazımıdır.
 *  - Yalnız Kobipo tasarımları (`options` saklı). Dışarıdan/portalden yüklenmiş
 *    şablonun içeriği bizde yok; üzerine yazmak kullanıcının tasarımını SİLERDİ.
 *  - Görsel DEĞİŞMEZ: aynı `options` ile yeniden üretilir, tek fark tabana sonradan
 *    eklenenlerdir. Aynı ad kullanıldığı için aktif seçim ve seri eşlemeleri bozulmaz.
 *
 * GÜVENLİK
 *  - `--uygula` verilmedikçe hiçbir şey yüklenmez (varsayılan kuru çalışma).
 *  - Canlı ortama bakan firmalara dokunmak için `--canli` ŞART: bu betik gerçek
 *    müşterilerin Mysoft hesabına yazar.
 *  - Taban XSLT okunamıyorsa betik BAŞLAMAZ ("yapacak iş yok" diye yalan söylemesin).
 */

// ORTAM DEĞİŞKENLERİ ÖNCE: Mysoft şifreleri `NEXTAUTH_SECRET`ten türeyen anahtarla
// şifrelenmiştir ([[lib/crypto/secrets.ts]]). Canlı veritabanındaki kayıtlar CANLININ
// anahtarıyla şifrelendiği için, geliştirme makinesindeki .env değeriyle çözülemezler
// ("Kayıtlı Mysoft şifresi çözülemedi"). Bu yüzden `.env.local` override ile yüklenir:
// `npm run vercel:env:pull` canlı ortamı oraya indirir ve betik o anahtarla çalışır.
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { prisma } from "@/lib/db/prisma"
import { ensureTemplateFresh } from "@/lib/integrations/e-invoice/template-refresh"
import {
  COMPANY_PROVIDER_SELECT,
  resolveCompanyEInvoiceProvider,
} from "@/lib/integrations/e-invoice/company-provider"
import { sampleVersionForDocType } from "@/lib/integrations/e-invoice/sample-templates"

const args = process.argv.slice(2)
const UYGULA = args.includes("--uygula")
const CANLI = args.includes("--canli")
const TEK_FIRMA = (args.find((a) => a.startsWith("--firma=")) || "").split("=")[1] || null

const tip = (t: number) => (t === 1 ? "e-Fatura" : t === 2 ? "e-Arşiv" : `tip ${t}`)

async function main() {
  // ÖN KONTROL: taban okunamıyorsa her kayıt "unknown-base" olur ve betik hiçbir şey
  // yapmadan "her şey güncel" der. Bu tam olarak canlıda haftalarca olan şeydi.
  const [v1, v2] = await Promise.all([sampleVersionForDocType(1), sampleVersionForDocType(2)])
  if (!v1 || !v2) {
    console.error(
      "\n  TABAN XSLT OKUNAMIYOR — lib/integrations/e-invoice/sample-templates/ altındaki\n" +
        "  .xslt dosyalarına erişilemiyor. Betik durdu (yanlışlıkla 'yapacak iş yok' demesin).\n",
    )
    process.exit(1)
  }
  console.log(`Güncel taban sürümü : e-Fatura ${v1} · e-Arşiv ${v2}`)
  console.log(`Mod                 : ${UYGULA ? "UYGULA (Mysoft'a yüklenecek)" : "kuru çalışma (yalnız rapor)"}\n`)

  // Kullanımdaki şablonlar: firma geneli aktif + seriye atanmış olanlar.
  const templates = await prisma.eInvoiceTemplate.findMany({
    where: { hidden: false, ...(TEK_FIRMA ? { companyId: TEK_FIRMA } : {}) },
    select: {
      companyId: true, eDocumentType: true, xsltName: true,
      isActive: true, options: true, baseVersion: true,
    },
  })
  const series = await prisma.eInvoiceSeriesTemplate.findMany({
    where: TEK_FIRMA ? { companyId: TEK_FIRMA } : {},
    select: { companyId: true, eDocumentType: true, prefix: true, xsltName: true },
  })
  const seriKey = new Set(series.map((s) => `${s.companyId}:${s.eDocumentType}:${s.xsltName}`))

  const kullanimda = templates.filter(
    (t) => t.isActive || seriKey.has(`${t.companyId}:${t.eDocumentType}:${t.xsltName}`),
  )
  const guncelSurum = (t: number) => (t === 1 ? v1 : v2)
  const bayat = kullanimda.filter(
    (t) => t.options != null && t.baseVersion !== guncelSurum(t.eDocumentType),
  )
  const disSablon = kullanimda.filter((t) => t.options == null)

  console.log(`Kullanımdaki şablon : ${kullanimda.length}`)
  console.log(`  bayat (tazelenecek): ${bayat.length}`)
  console.log(`  dış şablon (atlanır): ${disSablon.length}`)
  console.log(`  zaten güncel        : ${kullanimda.length - bayat.length - disSablon.length}\n`)

  if (bayat.length === 0) {
    console.log("Tazelenecek şablon yok.")
    return
  }

  // Firma bazında grupla: sağlayıcı (Mysoft kimliği) firma başına bir kez kurulur.
  const firmalar = new Map<string, typeof bayat>()
  for (const t of bayat) {
    const liste = firmalar.get(t.companyId) ?? []
    liste.push(t)
    firmalar.set(t.companyId, liste)
  }

  let tazelenen = 0
  let atlanan = 0
  let hatali = 0

  for (const [companyId, satirlar] of firmalar) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, ...COMPANY_PROVIDER_SELECT },
    })
    const isTest = /mytest\.tr/i.test(company?.eDonusumApiUrl || "")
    const ortam = isTest ? "TEST" : "CANLI"

    console.log(`── ${company?.name ?? companyId} [${ortam}] — ${satirlar.length} şablon`)

    if (!isTest && !CANLI) {
      console.log("   ATLANDI — canlı ortam; dokunmak için --canli ekleyin.\n")
      atlanan += satirlar.length
      continue
    }

    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      console.log(`   ATLANDI — sağlayıcı kurulamadı: ${resolved.error}\n`)
      atlanan += satirlar.length
      continue
    }

    for (const t of satirlar) {
      const etiket = `${t.xsltName} (${tip(t.eDocumentType)})`
      if (!UYGULA) {
        console.log(`   · tazelenecek: ${etiket} — taban ${t.baseVersion ?? "(damgasız)"}`)
        tazelenen++
        continue
      }
      try {
        const res = await ensureTemplateFresh({
          companyId,
          eDocumentType: t.eDocumentType,
          xsltName: t.xsltName,
          provider: resolved.provider,
          force: true,
        })
        if (res.refreshed) {
          console.log(`   ✓ ${etiket} → taban ${res.baseVersion}`)
          tazelenen++
        } else {
          console.log(`   ✗ ${etiket} — ${res.reason}${res.error ? `: ${res.error}` : ""}`)
          hatali++
        }
      } catch (e: any) {
        console.log(`   ✗ ${etiket} — ${e?.message || e}`)
        hatali++
      }
    }
    console.log("")
  }

  console.log(
    `${UYGULA ? "Tazelenen" : "Tazelenebilir"}: ${tazelenen} · atlanan: ${atlanan} · hatalı: ${hatali}`,
  )
  if (!UYGULA && tazelenen > 0) {
    console.log("Uygulamak için aynı komutu --uygula (canlı firmalar için --canli ile) çalıştırın.")
  }
}

main()
  .catch((e) => {
    console.error("\nHATA:", e?.message || e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
