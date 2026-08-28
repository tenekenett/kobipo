import { prisma } from "@/lib/db/prisma"
import {
  readSampleTemplate,
  sampleVersionForDocType,
} from "@/lib/integrations/e-invoice/sample-templates"
import {
  applyThemeToXslt,
  normalizeDesignOptions,
  sampleKeyForDocType,
} from "@/lib/integrations/e-invoice/template-designer"

/**
 * Belge tasarımının Mysoft'taki kopyasını GÜNCEL TUTAR.
 *
 * Sorun: Kobipo tasarımları repodaki taban XSLT'nin üzerine tema uygulanarak
 * üretilir, ama Mysoft belgeyi KENDİ kayıtlı kopyasıyla basar. Taban iyileştiğinde
 * (ör. kaleme açıklama satırı eklendiğinde) her firmanın kaydı eski kalır.
 *
 * Bunu kullanıcıya yaptırmak yanlış: iyileştirmeyi biz yapıyoruz, "gidip şablonunu
 * yenile" demek iç işimizi müşteriye devretmek olur. Bu yüzden senkron LAZY ve
 * OTOMATİKTİR: fatura gönderiminde (ve taslak önizlemede) kullanılacak tasarım
 * bayatsa, gönderimden hemen önce sessizce yeniden üretilip yüklenir.
 *
 * Kurallar:
 *  - Yalnız Kobipo tasarımları (options saklı) tazelenir; dışarıdan yüklenmiş
 *    şablonun içeriği bizde yok, üzerine yazmak kullanıcının tasarımını silerdi.
 *  - Tazeleme ASLA faturayı engellemez: hata olursa eski tasarımla gönderilir.
 *  - Aynı ad kullanılır → aktif seçim ve seri eşlemeleri bozulmaz.
 */

export type RefreshDecision =
  | { shouldRefresh: false; reason: "external" | "current" | "unknown-base" }
  | { shouldRefresh: true; reason: "stale" }

/**
 * Tazeleme kararı — saf fonksiyon (test edilebilir).
 *
 * `baseVersion` null ise kayıt bizim damgamızdan önce üretilmiştir; güncel olup
 * olmadığı bilinmez, bu yüzden bayat sayılır ve tazelenir.
 */
export function planTemplateRefresh(
  row: { options: unknown; baseVersion: string | null },
  currentVersion: string | null,
): RefreshDecision {
  if (row.options == null) return { shouldRefresh: false, reason: "external" }
  if (!currentVersion) return { shouldRefresh: false, reason: "unknown-base" }
  if (row.baseVersion === currentVersion) return { shouldRefresh: false, reason: "current" }
  return { shouldRefresh: true, reason: "stale" }
}

/** Üretilen XSLT'nin sağlığı — bozuk içeriği ASLA yüklemeyiz. */
export function isRenderableXslt(content: string): boolean {
  if (!content || content.length < 1000) return false
  if (!/<xsl:stylesheet|<xsl:transform/i.test(content)) return false
  // Kalem tablosu şablonu duruyor mu (tema uygulaması gövdeyi bozmamış olmalı).
  return content.includes("cac:InvoiceLine")
}

export type EnsureResult = {
  refreshed: boolean
  reason: RefreshDecision["reason"] | "uploaded" | "upload-failed" | "not-found" | "no-base"
  baseVersion?: string | null
  error?: string
}

/**
 * Verilen tasarımı gerekiyorsa yeniden üretip Mysoft'a aynı adla yükler ve
 * kaydı damgalar. `force` ile bayat olmasa da yeniden yükler (arayüzdeki
 * "Yenile" düğmesi bunu kullanır).
 */
export async function ensureTemplateFresh(params: {
  companyId: string
  eDocumentType: number
  xsltName: string
  provider: { addTenantXslt: (p: any) => Promise<{ success: boolean; error?: string }> }
  force?: boolean
}): Promise<EnsureResult> {
  const { companyId, eDocumentType, xsltName, provider, force = false } = params

  const row = await prisma.eInvoiceTemplate.findUnique({
    where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } },
    select: { options: true, baseVersion: true },
  })
  if (!row) return { refreshed: false, reason: "not-found" }

  const currentVersion = await sampleVersionForDocType(eDocumentType)
  const decision = planTemplateRefresh(row, currentVersion)
  if (!decision.shouldRefresh && !force) return { refreshed: false, reason: decision.reason }
  // Zorlamada bile dış şablona dokunulmaz.
  if (row.options == null) return { refreshed: false, reason: "external" }
  if (!currentVersion) return { refreshed: false, reason: "no-base" }

  const sampleKey = sampleKeyForDocType(eDocumentType)
  if (!sampleKey) return { refreshed: false, reason: "no-base" }
  const sample = await readSampleTemplate(sampleKey)
  if (!sample.available || !sample.content) return { refreshed: false, reason: "no-base" }

  const content = applyThemeToXslt(sample.content, normalizeDesignOptions(row.options))
  if (!isRenderableXslt(content)) {
    return { refreshed: false, reason: "upload-failed", error: "Üretilen şablon geçersiz görünüyor." }
  }

  const result = await provider.addTenantXslt({
    xsltName,
    eDocumentType,
    content,
    fileName: `${xsltName}.xslt`,
  })
  if (!result.success) {
    return { refreshed: false, reason: "upload-failed", error: result.error }
  }

  await prisma.eInvoiceTemplate.update({
    where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } },
    data: { baseVersion: currentVersion, refreshedAt: new Date(), hidden: false },
  })

  return { refreshed: true, reason: "uploaded", baseVersion: currentVersion }
}

/**
 * Gönderim/önizleme yolundan çağrılan SESSİZ sürüm: hata fırlatmaz, faturayı
 * asla engellemez. Tazeleme başarısızsa belge eski tasarımla gider.
 */
export async function ensureTemplateFreshQuietly(params: {
  companyId: string
  eDocumentType: number
  xsltName: string
  provider: { addTenantXslt: (p: any) => Promise<{ success: boolean; error?: string }> }
}): Promise<void> {
  try {
    const res = await ensureTemplateFresh(params)
    if (res.refreshed) {
      console.log(
        `[şablon] "${params.xsltName}" gönderim öncesi otomatik tazelendi (taban ${res.baseVersion}).`,
      )
    } else if (res.reason === "upload-failed") {
      console.warn(`[şablon] "${params.xsltName}" tazelenemedi: ${res.error} — eski tasarımla devam.`)
    } else if (res.reason === "unknown-base" || res.reason === "no-base") {
      // BU NORMAL BİR DURUM DEĞİL, DAĞITIM HATASIDIR: taban XSLT okunamıyor demektir
      // ve tazeleme hiç çalışmaz. Sessiz kalmak pahalıya patladı — kapsam dışı
      // bırakılmış bir `outputFileTracingIncludes` yüzünden otomatik tazeleme
      // canlıda haftalarca hiç koşmadı, kimse fark etmedi, firmalar eski tasarımla
      // belge bastı. Gönderimi hâlâ engellemiyoruz ama artık görünür.
      console.error(
        `[şablon] TABAN XSLT OKUNAMIYOR ("${params.xsltName}", tip ${params.eDocumentType}) — ` +
          `otomatik tazeleme çalışmıyor, belgeler ESKİ tasarımla basılıyor. ` +
          `Örnek şablonlar bu fonksiyonun paketinde mi? (next.config.js → ` +
          `outputFileTracingIncludes, "/api/e-donusum/**")`,
      )
    }
  } catch (e: any) {
    console.warn(`[şablon] tazeleme atlandı: ${e?.message || e}`)
  }
}
