/**
 * Uygulamanın mutlak temel URL'i — davet, şifre sıfırlama, abonelik uyarısı gibi
 * MÜŞTERİYE GİDEN bağlantılarda kullanılır.
 *
 * ⚠️ İstek host'una körü körüne güvenilmez. Vercel zamanlanmış işleri (cron) ve
 * webhook'ları uygulamaya **dağıtıma özgü** adresle çağırır — `host` başlığı
 * `kobipo-ri4t58v21-tenekenets-projects.vercel.app` gibi, her dağıtımda DEĞİŞEN bir
 * adrestir. 2026-09-07'de abonelik uyarısı e-postası bu adresle gitti: müşteri
 * e-postasında marka domaini yerine üç satırlık bir dağıtım adresi göründü (kurumsal
 * durmuyor, oltalama gibi okunuyor ve dağıtım koruması açıksa link 401 verir).
 *
 * Bu yüzden host YALNIZ kanonikse kullanılır; değilse ortam değişkenine, o da yoksa
 * marka domainine (`siteConfig.url`) düşülür.
 */

import { siteConfig } from "@/lib/seo/site-config"

const stripSlash = (url: string) => url.trim().replace(/\/+$/, "")

/**
 * Adres, projeye değil TEK BİR DAĞITIMA ait mi?
 *
 * Vercel'in üretim/önizleme dağıtımlarına verdiği otomatik `*.vercel.app` adresleri
 * kalıcı değildir ve müşteriye gösterilmez. Özel domain (kobipo.com) bu kalıba girmez.
 */
function isDeploymentHost(host: string): boolean {
  return /(^|\.)vercel\.app(:\d+)?$/i.test(host)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

/**
 * İstekten bağımsız, kanonik uygulama adresi. Sırasıyla: ortam değişkenleri →
 * Vercel'in üretim domaini → marka domaini. Dağıtıma özgü adresler her adımda elenir.
 */
export function appBaseUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const url = stripSlash(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!isDeploymentHost(hostOf(url))) return url
  }
  return stripSlash(siteConfig.url)
}

/**
 * Bir Request'ten uygulamanın mutlak temel URL'ini çözer.
 * Öncelik: gelen origin başlığı → host (+ x-forwarded-proto) → kanonik adres.
 *
 * `origin` varsa istek gerçekten bir tarayıcıdan gelmiştir; kullanıcı hangi adrese
 * bakıyorsa (önizleme dağıtımı dahil) link o adresle üretilir — ödeme dönüş adresleri
 * bunu gerektirir. `origin` yoksa istek cron/webhook'tur ve host'a güvenilmez.
 */
export function resolveBaseUrl(request: Request): string {
  const origin = request.headers.get("origin")
  if (origin) return stripSlash(origin)

  const host = request.headers.get("host")
  if (host && !isDeploymentHost(host)) {
    const proto = request.headers.get("x-forwarded-proto") || "https"
    return stripSlash(`${proto}://${host}`)
  }

  return appBaseUrl()
}
