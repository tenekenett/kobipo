import { readFile } from "fs/promises"
import path from "path"

/**
 * Kobipo'ya gömülü örnek belge şablonları (XSLT).
 *
 * Mysoft kendi portalinde E-Fatura ve E-Arşiv için hazır örnek şablonlar sunar;
 * biz de aynı iki tip için örnek XSLT'leri burada bulundururuz. Kullanıcı bir
 * örneği "PDF Önizle" ile görüp "Bu Şablonu Tanımla" ile Mysoft hesabına
 * yükleyebilir (addTenantXslt).
 *
 * Dosyalar ./<key>.xslt olarak durur. Bir dosya gerçek bir XSLT içermiyorsa
 * (placeholder) `available=false` döner ve UI ilgili butonları kapatır.
 *
 * Not: Vercel'de bu .xslt dosyalarının fonksiyon paketine dahil edilmesi için
 * next.config.js > outputFileTracingIncludes ayarı gerekir.
 */

export interface SampleTemplateMeta {
  key: string
  label: string
  /** Mysoft belge tipi: 1=E-Fatura, 2=E-Arşiv */
  eDocumentType: number
  fileName: string
}

export const SAMPLE_TEMPLATES: SampleTemplateMeta[] = [
  { key: "e-fatura", label: "E-Fatura — Örnek Şablon", eDocumentType: 1, fileName: "e-fatura.xslt" },
  { key: "e-arsiv", label: "E-Arşiv — Örnek Şablon", eDocumentType: 2, fileName: "e-arsiv.xslt" },
]

export function getSampleMeta(key: string): SampleTemplateMeta | undefined {
  return SAMPLE_TEMPLATES.find((t) => t.key === key)
}

const SAMPLES_DIR = path.join(
  process.cwd(),
  "lib",
  "integrations",
  "e-invoice",
  "sample-templates",
)

/**
 * Örnek şablonun ham XSLT içeriğini okur. Dosya yoksa ya da placeholder ise
 * `available=false` döner (content boş).
 */
export async function readSampleTemplate(
  key: string,
): Promise<{ available: boolean; content: string; meta: SampleTemplateMeta | null }> {
  const meta = getSampleMeta(key)
  if (!meta) return { available: false, content: "", meta: null }
  try {
    const content = await readFile(path.join(SAMPLES_DIR, meta.fileName), "utf8")
    // Gerçek bir stylesheet mi? Placeholder dosyalarda <xsl bulunmaz.
    const available = /<xsl:stylesheet|<xsl:transform/i.test(content)
    return { available, content: available ? content : "", meta }
  } catch {
    return { available: false, content: "", meta }
  }
}

/** Tüm örneklerin uygunluk durumunu döndürür (UI listesi için). */
export async function listSampleTemplates(): Promise<
  Array<SampleTemplateMeta & { available: boolean }>
> {
  return Promise.all(
    SAMPLE_TEMPLATES.map(async (meta) => {
      const { available } = await readSampleTemplate(meta.key)
      return { ...meta, available }
    }),
  )
}
