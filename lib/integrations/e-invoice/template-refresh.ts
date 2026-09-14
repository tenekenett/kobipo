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
import {
  templateStatus,
  type TemplateStatus,
  type TenantXsltEntry,
} from "@/lib/integrations/e-invoice/template-approval"

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
 *  - ONAYLI kopya SESSİZCE yeniden yüklenmez (2026-09-14). Her yükleme Mysoft'ta
 *    onay sürecine girer; onay elle ve saatler/günler sonra gelir, reddedilebilir de.
 *    e-Arşiv onaysız şablonla HİÇ basılmaz (e-Fatura sessizce GİB standart dizayna
 *    düşer). Eren Forklift'te 3 Eylül'deki otomatik tazeleme şablonu onaydan
 *    düşürdü, 9–14 Eylül arası tek bir e-Arşiv kesilemedi. Taban iyileştirmesini
 *    onaylı bir tasarıma taşımanın yolu artık "Yenile" düğmesidir (force) — ekran
 *    sonucu (onay bekliyor) söyler. Durum okunamıyorsa da yüklenmez: risk, kazançtan
 *    (kozmetik güncelleme) büyük.
 */

export type RefreshDecision =
  | { shouldRefresh: false; reason: "external" | "current" | "unknown-base" }
  | { shouldRefresh: true; reason: "stale" }

/**
 * Onay koruması — saf fonksiyon. Mysoft'taki kopya ONAYLIYSA (ya da durumu
 * bilinmiyorsa) sessiz yükleme yapılmaz; onay bekleyen/olmayan kopyada kaybedecek
 * onay yoktur, yükleme serbest.
 */
export function uploadWouldRiskApproval(status: TemplateStatus | "unknown"): boolean {
  return status === "approved" || status === "unknown"
}

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
  reason:
    | RefreshDecision["reason"]
    | "uploaded"
    | "upload-failed"
    | "not-found"
    | "no-base"
    /** Mysoft'taki kopya onaylı: sessiz yükleme onayı düşürürdü, atlandı. */
    | "approved-copy"
    /** Onay durumu okunamadı: risk alınmadı, atlandı. */
    | "approval-unknown"
  baseVersion?: string | null
  error?: string
  /** Yükleme sonrası Mysoft'un söylediği onay durumu (okunamadıysa null). */
  approvedAfterUpload?: boolean | null
}

type RefreshProvider = {
  addTenantXslt: (p: any) => Promise<{ success: boolean; error?: string }>
  listTenantXslt?: (
    vknTckn?: string,
    eDocumentType?: number,
  ) => Promise<{ success: boolean; data?: TenantXsltEntry[]; error?: string }>
}

/** Mysoft'taki kopyanın onay durumu; liste okunamazsa "unknown". */
async function mysoftTemplateStatus(
  provider: RefreshProvider,
  eDocumentType: number,
  xsltName: string,
): Promise<TemplateStatus | "unknown"> {
  if (!provider.listTenantXslt) return "unknown"
  try {
    const list = await provider.listTenantXslt()
    if (!list.success || !list.data) return "unknown"
    return templateStatus(list.data, eDocumentType, xsltName)
  } catch {
    return "unknown"
  }
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
  provider: RefreshProvider
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

  // ONAY KORUMASI: sessiz tazeleme onaylı kopyayı onaydan düşürür (ya da Mysoft
  // incelemesinde reddedilir) ve e-Arşiv o şablonla kesilemez olur. Yalnız
  // kullanıcının bilerek bastığı "Yenile" (force) bu riski alır.
  if (!force) {
    const status = await mysoftTemplateStatus(provider, eDocumentType, xsltName)
    if (uploadWouldRiskApproval(status)) {
      return { refreshed: false, reason: status === "approved" ? "approved-copy" : "approval-unknown" }
    }
  }

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

  // Yükleme onayı düşürdü mü? Ekran bunu söylesin; "güncellendi" deyip geçmek,
  // e-Arşiv'in o şablonla kesilemez hale geldiğini gizlerdi.
  const after = await mysoftTemplateStatus(provider, eDocumentType, xsltName)
  const approvedAfterUpload = after === "unknown" ? null : after === "approved"

  return { refreshed: true, reason: "uploaded", baseVersion: currentVersion, approvedAfterUpload }
}

/**
 * Gönderim/önizleme yolundan çağrılan SESSİZ sürüm: hata fırlatmaz, faturayı
 * asla engellemez. Tazeleme başarısızsa belge eski tasarımla gider.
 */
const protectedLogged = new Set<string>()

export async function ensureTemplateFreshQuietly(params: {
  companyId: string
  eDocumentType: number
  xsltName: string
  provider: RefreshProvider
}): Promise<void> {
  try {
    const res = await ensureTemplateFresh(params)
    if (res.reason === "approved-copy" || res.reason === "approval-unknown") {
      // Her gönderimde tekrarlamasın; süreç başına bir kez görünür olsun.
      const key = `${params.companyId}:${params.eDocumentType}:${params.xsltName}`
      if (!protectedLogged.has(key)) {
        protectedLogged.add(key)
        console.log(
          `[şablon] "${params.xsltName}" tabanı eski ama ${
            res.reason === "approved-copy" ? "Mysoft'ta ONAYLI" : "onay durumu okunamadı"
          } — otomatik tazeleme atlandı (onayı düşürürdü). Güncellemek için Belge Şablonları → Yenile.`,
        )
      }
    } else if (res.refreshed) {
      console.log(
        `[şablon] "${params.xsltName}" gönderim öncesi otomatik tazelendi (taban ${res.baseVersion}).`,
      )
    } else if (res.reason === "upload-failed") {
      console.warn(`[şablon] "${params.xsltName}" tazelenemedi: ${res.error} — eski tasarımla devam.`)
    } else if (res.reason === "unknown-base" || res.reason === "no-base") {
      // BU NORMAL BİR DURUM DEĞİL, DAĞITIM HATASIDIR: taban XSLT okunamıyor demektir
      // ve tazeleme hiç çalışmaz — üstelik hata da fırlatmadan.
      //
      // Bu dal eskiden hiç loglanmıyordu ve o sessizlik bir teşhisi saatlerce yanlış
      // yola soktu: "şablonlar eski" şikâyeti gelince kapsam dışı kalmış bir
      // `outputFileTracingIncludes` sanıldı. Değilmiş — ölçünce mekanizmanın canlıda
      // düzgün çalıştığı, bayat kalanların yalnızca o belge tipinden hiç gönderim
      // yapılmamış şablonlar olduğu görüldü. Log olsaydı bu ilk bakışta anlaşılırdı.
      // Gönderimi hâlâ engellemiyoruz ama artık görünür.
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
