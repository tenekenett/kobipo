// Sayfa kapısının HARİTA KAPSAMI nöbetçisi.
//
// `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` açıldığından beri `PAGE_API_RULES` yalnız
// kısıtlı çalışanları değil, HERKESİ bağlar. Bu da haritadaki bir boşluğun bedelini
// büyüttü: kuralı unutulmuş bir yazma ucu artık ADMIN'e bile kapalı doğar.
//
// Bu dosya iki değişmezi mekanik olarak korur (bkz. `npm run check:rls` deseni —
// aynı fikir, ama harita TypeScript'te yaşadığı için testte duruyor):
//
//   1. Kapıyı çağıran hiçbir uç ADMIN'i reddetmez.
//   2. Yazma kabul eden her kapılı ucun ya bir kuralı vardır ya da aşağıda
//      SAHİPSİZ listesinde ADIYLA anılır.
//
// Diğer test dosyalarından farklı olarak dosya sistemini okur: kapının gerçek yüzeyi
// `app/api/**/route.ts` dosyalarıdır ve o yüzey elle tutulan bir listeye sığmaz.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { isApiPathAllowedForUser, pageRuleForApiPath, type PagePermissions } from "./page-access"

const API_ROOT = path.resolve(process.cwd(), "app/api")

/**
 * Menüde karşılığı OLMAYAN, dolayısıyla hiçbir sayfaya bağlanamayan yazma uçları.
 *
 * **Liste 2026-08-20'de BOŞALDI.** Muhasebe defterleri (`/api/muhasebe/*`) buradaydı:
 * kuralsız oldukları için okumada serbest, yazmada kapalı kalıyorlardı — yani doğru
 * davranış SESSİZ bir varsayılandan geliyordu. Artık `PAGE_API_RULES`'ta açık bir
 * kuralları var (`pages: mali tablolar, writePages: []`), dolayısıyla muafiyete gerek
 * kalmadı.
 *
 * Buraya yeni bir uç eklemek son çare olmalı: "sahibi yok" demek, o ucun yazma
 * sözleşmesini kimsenin okuyamayacağı bir yere saklamaktır. Önce `NAV_PAGES` +
 * `PAGE_API_RULES`'a bir satır eklemeyi deneyin.
 */
const OWNERLESS_WRITE_ENDPOINTS: string[] = []

/**
 * Kapıyı HİÇ çağırmayan ama firma verisiyle çalışan uçlar ve korumaları.
 *
 * Sayfa/modül kapısı yalnız `ensureCompanyAccess` çağıran uçlarda çalışır; çağırmayan
 * bir uç haritadan hiç etkilenmez. Bu, tasarım gereği böyle (süper-admin uçları, token
 * ile açılan ödeme bağlantısı, ilk firma kurulumu) — ama SESSİZ kalırsa bir gün
 * kapısız bir uç fark edilmeden aramıza karışır. Nitekim karışmıştı: bu liste
 * kurulurken `GET /api/e-donusum/invoices/[id]/status` yakalandı — giriş yapmış
 * herhangi bir kullanıcı, id'sini bildiği BAŞKA firmanın faturasının GİB durumunu
 * sorgulayabiliyor, hatta iptaline yol açabiliyordu. O uca kapı eklendi.
 *
 * Yeni satır eklemeden önce: gerçekten kapı gerekmiyor mu, yoksa unutuldu mu?
 */
const GATE_EXEMPT_ENDPOINTS: Record<string, string> = {
  "/admin/support/[id]/messages": "requireSuperAdmin",
  "/auth/user-role": "Kullanıcının KENDİ rolünü döndürür; başkasının verisi yok.",
  "/billing/admin/quota": "requireSuperAdmin",
  "/billing/admin/reset": "requireSuperAdmin",
  "/companies":
    "GET üyelik listesini `getUserContext`ten süzer; POST `createCompany` içindeki erişim + rol + kota denetimine tabidir (bkz. npm run check:company-create).",
  "/company/branch-managers": "canManageCompany (üyeliksiz yönetici kapsamı dahil)",
  "/company/role-templates":
    "Hazır rol kalıbı KATALOĞU geneldir — firmaya ait veri döndürmez, yalnız oturum arar. Yazma ucu sistem-admin tarafındadır (requireSuperAdmin).",
  "/invitations/[token]/accept":
    "Davet TOKEN'ı ile açılır — çağıran henüz o firmanın üyesi değildir, kapı zaten reddederdi.",
  "/pay/[token]": "Ödeme bağlantısı token ile açılır; oturum gerektirmez.",
  "/system-admin/users": "isSuperAdmin denetimi handler içinde",
  "/system-admin/users/[id]/companies": "isSuperAdmin denetimi handler içinde",
  "/system-admin/users/[id]/companies/[companyId]": "requireSuperAdmin (dosya içi)",
}

type Route = { urlPath: string; file: string; methods: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === "route.ts") out.push(full)
  }
  return out
}

const METHOD_RE = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
const GATE_RE = /ensureCompanyAccess|ensureCompanyWrite|ensureCompanyExport|assertPagePath/

/** Kapıyı çağıran uçlar — kapının gerçek yüzeyi budur. */
function gatedRoutes(): Route[] {
  return walk(API_ROOT)
    .map((file) => {
      const src = fs.readFileSync(file, "utf8")
      if (!GATE_RE.test(src)) return null
      const segments = path
        .relative(API_ROOT, path.dirname(file))
        .split(path.sep)
        .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
        // Dinamik segment yerine örnek bir değer: kural eşleşmesi ön ekle yapılır.
        .map((s) => (s.startsWith("[") ? "x" : s))
      return {
        urlPath: "/api" + (segments.length ? "/" + segments.join("/") : ""),
        file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
        methods: [...new Set([...src.matchAll(METHOD_RE)].map((m) => m[1]))],
      }
    })
    .filter((r): r is Route => r !== null)
}

const admin: PagePermissions = { role: "ADMIN", allowedPaths: [], writablePaths: [] }
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

describe("PAGE_API_RULES — kapsam nöbetçisi", () => {
  const routes = gatedRoutes()

  it("kapıyı çağıran uçlar bulunuyor (tarama gerçekten çalışıyor)", () => {
    // Tarama sessizce boşa düşerse aşağıdaki iki test de boş küme üzerinde "geçer".
    expect(routes.length).toBeGreaterThan(100)
  })

  it("hiçbir uç ADMIN'i reddetmez", () => {
    const denied: string[] = []
    for (const route of routes) {
      for (const method of route.methods) {
        if (isApiPathAllowedForUser(route.urlPath, method, admin)) continue
        if (WRITE_METHODS.includes(method) && OWNERLESS_WRITE_ENDPOINTS.includes(route.urlPath)) continue
        denied.push(`${method} ${route.urlPath}  (${route.file})`)
      }
    }
    expect(denied, `ADMIN şu uçlarda kapıya takılıyor:\n${denied.join("\n")}`).toEqual([])
  })

  it("firma verisiyle çalışan her uç ya kapıyı çağırır ya listede anılır", () => {
    const ungated: string[] = []
    for (const file of walk(API_ROOT)) {
      const src = fs.readFileSync(file, "utf8")
      if (GATE_RE.test(src)) continue
      // `companyId` geçmeyen uç firma verisine dokunmuyordur (kur, sağlık kontrolü,
      // blog, cron). Kaba ama yanlış tarafa kaba: kaçırırsa listeye YAZDIRIR.
      if (!/companyId/.test(src)) continue
      const urlPath =
        "/" + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/")
      if (urlPath in GATE_EXEMPT_ENDPOINTS) continue
      ungated.push(`${urlPath}  (${path.relative(process.cwd(), file)})`)
    }
    expect(
      ungated,
      "Şu uçlar firma verisiyle çalışıyor ama kapıyı hiç çağırmıyor. Kapıyı ekleyin " +
        `(ensureCompanyAccess/ensureCompanyWrite) ya da korumasını GATE_EXEMPT_ENDPOINTS'e yazın:\n${ungated.join("\n")}`,
    ).toEqual([])
  })

  it("yazma kabul eden her kapılı ucun sahibi bellidir", () => {
    const orphans: string[] = []
    for (const route of routes) {
      const writes = route.methods.filter((m) => WRITE_METHODS.includes(m))
      if (writes.length === 0) continue
      if (OWNERLESS_WRITE_ENDPOINTS.includes(route.urlPath)) continue
      // Kuralı olan uç, sahibini AÇIKÇA taşır: `personal` (herkesin kendi işi),
      // `writePages: []` (bilinçli salt-okunur) ya da sayfa listesi. Kuralı hiç
      // olmayan uç ise sessizce kapalı doğar — yakalanması gereken durum budur.
      if (!pageRuleForApiPath(route.urlPath)) {
        orphans.push(`${writes.join(",")} ${route.urlPath}  (${route.file})`)
      }
    }
    expect(
      orphans,
      `Şu yazma uçlarının PAGE_API_RULES'ta kuralı yok — kural ekleyin ya da\n` +
        `OWNERLESS_WRITE_ENDPOINTS'e gerekçesiyle yazın:\n${orphans.join("\n")}`
    ).toEqual([])
  })

  it("kapıyı çağıran her handler withApiErrors ile sarılıdır", () => {
    // Kapı hata FIRLATIR; sarılı olmayan handler'da bu hata Next'e kadar çıkar ve
    // kullanıcı boş gövdeli 500 alır (erişim yine engellenir, ama sebebi görünmez).
    //
    // "İç try/catch var" YETMEZ — ölçüt bilerek sarmalayıcının kendisidir: rol
    // testinde `POST /api/company/roles` tam olarak böyle 500 döndü, çünkü
    // `ensureCompanyAccess` çağrısı handler'ın try bloğunun DIŞINDAYDI ve iç catch
    // hatayı hiç görmedi. Sarmalayıcı ise handler'dan kaçan her şeyi yakalar.
    const unwrapped: string[] = []
    const PLAIN = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm
    for (const route of routes) {
      const src = fs.readFileSync(path.resolve(process.cwd(), route.file), "utf8")
      for (const m of src.matchAll(PLAIN)) {
        unwrapped.push(`${m[1]} ${route.file}`)
      }
    }
    expect(
      unwrapped,
      `Şu handler'lar sarılı değil — gövdeyi \`withApiErrors(async function X(…) {…})\`\n` +
        `içine alın (bkz. lib/api/errors.ts):\n${unwrapped.join("\n")}`
    ).toEqual([])
  })
})
