import { prisma } from "@/lib/db/prisma"

/**
 * Erişim (trafik) kaydı — giriş, çıkış, kayıt ve başarısız denemeler.
 *
 * NEDEN: uygulama bugüne kadar hiçbir oturum açma kaydı tutmuyordu. Bir uyuşmazlıkta
 * ("bu faturayı kim sildi", "hesabıma başkası girdi") elde tek veri kalmıyordu.
 *
 * TASARIM — üç karar:
 *
 * 1. **FAIL-OPEN.** Kayıt yazılamazsa giriş ENGELLENMEZ. Defter tutmak kimsenin
 *    hesabına giremediği bir uygulamadan daha önemli değil; hata konsola yazılır.
 * 2. **Uydurulmaz.** Vekil sunucu portu iletmiyorsa port null kalır. "0" ya da sunucu
 *    portunu yazmak, sonradan o kaydı okuyan kişiyi yanıltır.
 * 3. **Zincir saklanır.** Tek bir IP yanıltıcı olabilir (CDN + kurumsal vekil).
 *    `x-forwarded-for` zincirinin tamamı ayrıca yazılır.
 */

export type AccessAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "SIGNUP"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET"

export type ClientInfo = {
  ip: string | null
  /** İstemcinin KAYNAK portu — yalnız vekil iletirse dolu (aşağıya bkz.). */
  port: number | null
  forwardedFor: string | null
  userAgent: string | null
}

/** Header sözlüğü: NextAuth `req.headers` (düz nesne) ile `Headers` aynı yerden okunur. */
type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined | null

function pick(bag: HeaderBag, name: string): string | null {
  if (!bag) return null
  if (typeof (bag as Headers).get === "function") {
    return (bag as Headers).get(name)
  }
  const rec = bag as Record<string, string | string[] | undefined>
  const value = rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * "1.2.3.4:5678" ya da "[::1]:5678" biçimini ayırır.
 *
 * Bazı vekiller (nginx `$remote_addr:$remote_port`, kimi yük dengeleyiciler) istemci
 * portunu XFF girdisine ekler. IPv6 iki nokta içerdiği için köşeli parantez şart:
 * "::1" içindeki son iki noktayı port ayracı sanmak adresi bozardı.
 */
function splitIpPort(raw: string): { ip: string; port: number | null } {
  const value = raw.trim()
  const bracketed = value.match(/^\[(.+)\]:(\d{1,5})$/)
  if (bracketed) return { ip: bracketed[1], port: Number(bracketed[2]) }
  const ipv4 = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/)
  if (ipv4) return { ip: ipv4[1], port: Number(ipv4[2]) }
  return { ip: value, port: null }
}

/**
 * İstemci bilgilerini header'lardan çözer.
 *
 * IP sırası: `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for`in İLK girdisi.
 * Zincirin ilki istemciye en yakın olandır; sonrakiler vekillerdir.
 *
 * PORT: `x-forwarded-port` BİLEREK kullanılmaz — o, isteğin ulaştığı SUNUCU portudur
 * (443), istemcinin kaynak portu değil. Onu "istemci portu" diye yazmak defteri
 * kullanışsız kılardı. Yalnız gerçekten kaynak portu taşıyan başlıklar okunur.
 */
export function clientInfoFromHeaders(bag: HeaderBag): ClientInfo {
  const xff = pick(bag, "x-forwarded-for")
  const firstHop = xff?.split(",")[0]?.trim() || null

  const candidates = [pick(bag, "cf-connecting-ip"), pick(bag, "x-real-ip"), firstHop]
  const rawIp = candidates.find((c) => c && c.length > 0) ?? null

  const parsed = rawIp ? splitIpPort(rawIp) : { ip: null as string | null, port: null }
  // Kaynak portunu ayrıca taşıyan başlıklar (Cloudflare Spectrum, bazı ters vekiller).
  const headerPort =
    pick(bag, "cf-connecting-port") ?? pick(bag, "x-client-port") ?? pick(bag, "x-real-port")
  const port = parsed.port ?? (headerPort && /^\d{1,5}$/.test(headerPort) ? Number(headerPort) : null)

  return {
    ip: parsed.ip,
    port,
    forwardedFor: xff,
    userAgent: pick(bag, "user-agent"),
  }
}

/**
 * Kaydı yazar. HİÇBİR ZAMAN fırlatmaz — çağıran akış (giriş, kayıt) bundan etkilenmez.
 *
 * `await` edilmesi beklenir ama sonucu kontrol edilmez: kaydın yazılamaması kullanıcıya
 * gösterilecek bir hata değildir, operasyonel bir sorundur (konsola düşer).
 */
export async function recordAccess(input: {
  action: AccessAction
  info: ClientInfo
  userId?: string | null
  email?: string | null
  reason?: string | null
}): Promise<void> {
  try {
    await prisma.accessLog.create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        // E-posta küçük harfe indirgenir: aynı hesabın kayıtları aramada dağılmasın.
        email: input.email ? input.email.trim().toLowerCase() : null,
        reason: input.reason ?? null,
        ip: input.info.ip,
        port: input.info.port,
        forwardedFor: input.info.forwardedFor,
        userAgent: input.info.userAgent,
      },
    })
  } catch (error) {
    console.error("access log yazılamadı:", error)
  }
}
