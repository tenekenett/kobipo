/**
 * KONTÖR YALNIZ KOBİPO BAYİLİĞİ ALTINDAKİ MÜKELLEFE YÜKLENİR.
 *
 * `insertDocumentCredit` bayi (İş Ortağı) kimliğiyle çağrılır ve Mysoft yalnız bayinin
 * altına tanımlı mükellefe yükler; başkasına "firması sizin hesabınızda tanımlı olan
 * firmalar arasında yer almamaktadır" der. Kobipo'dan ÖNCE kendi Mysoft hesabını açmış
 * müşteri (Eren Forklift, 2026-09-21) bu listede değildir: 375 TL kart ödemesi alındı,
 * yükleme reddedildi, sipariş FAILED'a düştü. Bayi API'sinde mevcut mükellefi bayiye
 * bağlayan uç yok (addTenant yalnız yeni mükellef açar) — yani ret sonradan
 * düzeltilemez, sipariş AÇILMADAN önce sorulmalı.
 *
 * Bu modül o soruyu tek yerde cevaplar: sipariş ucu (POST /api/kontor/orders) ve satın
 * alma penceresinin ön kontrolü (GET /api/kontor/eligibility) aynı fonksiyondan geçer.
 * Liste kısa süre önbelleklenir: pencere açılışı + sipariş için iki ayrı Mysoft girişi
 * yapılmasın. Liste ALINAMAZSA sipariş yine açılmaz (dürüst ret) — sessiz geçip parayı
 * aldıktan sonra ret yemek bugünkü hatanın kendisidir.
 */
import { createPartnerProvider, PARTNER_NOT_CONFIGURED_ERROR } from "@/lib/integrations/e-invoice/partner"

export type DealerTenant = { tenantName?: string; shortName?: string; vknTckn: string; isPassive?: boolean }

export type KontorEligibility =
  | { ok: true; vkn: string; tenantName: string | null }
  | { ok: false; vkn: string; code: "NOT_LISTED" | "UNAVAILABLE" | "NOT_CONFIGURED"; message: string; status: number }

export const KONTOR_NOT_LISTED_MESSAGE =
  "Bu firmanın e-Dönüşüm hesabı Kobipo üzerinden kontör yüklemesine kapalı: mükellef Kobipo bayiliği altında tanımlı değil. Kontörü mevcut e-Dönüşüm sağlayıcınızdan alabilir ya da Kobipo desteğine yazabilirsiniz. Ödeme alınmadı."

export const KONTOR_CHECK_UNAVAILABLE_MESSAGE =
  "Kontör yüklenebilirliği şu an doğrulanamıyor (Mysoft'a ulaşılamadı). Birazdan tekrar deneyin; ödeme alınmadı."

/** Firma kartından kontörün yükleneceği VKN/TCKN; geçersizse null. */
export function resolveKontorTargetVkn(company: { eDonusumTenantVkn?: string | null; taxNumber?: string | null } | null): string | null {
  const vkn = (company?.eDonusumTenantVkn || company?.taxNumber || "").replace(/\D/g, "")
  return vkn.length === 10 || vkn.length === 11 ? vkn : null
}

/** Saf kural: VKN listede AKTİF bir mükellef olarak var mı? */
export function findDealerTenant(list: DealerTenant[], vkn: string): DealerTenant | null {
  const target = String(vkn || "").replace(/\D/g, "")
  if (!target) return null
  return list.find((t) => String(t?.vknTckn ?? "").replace(/\D/g, "") === target && !t.isPassive) ?? null
}

// Kısa süreli liste önbelleği (süreç içi; sunucusuz ortamda örnek başına).
const CACHE_TTL_MS = 2 * 60 * 1000
let cache: { at: number; list: DealerTenant[] } | null = null

async function loadDealerTenants(): Promise<
  { ok: true; list: DealerTenant[] } | { ok: false; code: "UNAVAILABLE" | "NOT_CONFIGURED"; error: string }
> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { ok: true, list: cache.list }
  const provider = createPartnerProvider()
  if (!provider) return { ok: false, code: "NOT_CONFIGURED", error: PARTNER_NOT_CONFIGURED_ERROR }
  try {
    const res = await provider.listTenants()
    if (!res.success) return { ok: false, code: "UNAVAILABLE", error: res.error || "Firma listesi alınamadı." }
    cache = { at: Date.now(), list: res.data ?? [] }
    return { ok: true, list: cache.list }
  } catch (e: any) {
    return { ok: false, code: "UNAVAILABLE", error: e?.message || "Bilinmeyen hata" }
  }
}

/** Testler ve "Yenile" için: önbelleği düşür. */
export function resetDealerTenantCache() {
  cache = null
}

/**
 * Bu VKN'ye bayi kimliğiyle kontör yüklenebilir mi? Sipariş açmadan ÖNCE çağrılır.
 * Başarısız yanıtlar HTTP durumunu da taşır: 412 (listede değil), 503 (doğrulanamadı /
 * bayi kimliği yok).
 */
export async function checkKontorEligibility(vkn: string): Promise<KontorEligibility> {
  const target = String(vkn || "").replace(/\D/g, "")
  const loaded = await loadDealerTenants()
  if (!loaded.ok) {
    console.error("[kontor] bayi mükellef listesi alınamadı:", loaded.error)
    return {
      ok: false,
      vkn: target,
      code: loaded.code,
      message: loaded.code === "NOT_CONFIGURED" ? PARTNER_NOT_CONFIGURED_ERROR : KONTOR_CHECK_UNAVAILABLE_MESSAGE,
      status: 503,
    }
  }
  const tenant = findDealerTenant(loaded.list, target)
  if (!tenant) {
    console.warn(`[kontor] VKN ${target} bayi altında tanımlı değil; sipariş açılmadı.`)
    return { ok: false, vkn: target, code: "NOT_LISTED", message: KONTOR_NOT_LISTED_MESSAGE, status: 412 }
  }
  return { ok: true, vkn: target, tenantName: tenant.tenantName || tenant.shortName || null }
}
