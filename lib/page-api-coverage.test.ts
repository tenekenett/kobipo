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
 * `/muhasebe/yevmiye` ve `/muhasebe/kebir` ekranları `NAV_PAGES`'te değil (menüde
 * yoklar, yalnız `/raporlar/finansal` içinden link veriliyor) ve bu iki uca arayüzden
 * HİÇ POST yapılmıyor — iki sayfa da yalnız GET çağırıyor. Rapor sayfasına sahip
 * yazmak "raporu gören yevmiye fişi keser" demek olurdu; bu yüzden yazma kapalı
 * bırakıldı. Muhasebe ekranı menüye alınırsa doğru çözüm buraya değil, `NAV_PAGES` +
 * `PAGE_API_RULES`'a bir satır eklemektir.
 */
const OWNERLESS_WRITE_ENDPOINTS = ["/api/muhasebe/fisler", "/api/muhasebe/hesap-plani"]

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
const GATE_RE = /ensureCompanyAccess|ensureCompanyWrite|assertPagePath/

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
