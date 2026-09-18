/**
 * API uç envanteri — STATİK tarama (dosya okur, sunucuya gitmez).
 *
 *   node scripts/uctan-uca/envanter.mjs            → özet + kapısız uçlar
 *   node scripts/uctan-uca/envanter.mjs --json     → envanter.json (tarama.mjs okur)
 *
 * Her `app/api/** /route.ts` için: dışa verilen metotlar, hangi KAPI'dan geçtiği
 * (ensureCompanyAccess / requireSuperAdmin / oturum / cron sırrı / webhook / açık),
 * okuduğu query anahtarları ve dinamik parçalar. "Kapısız" bulgu = hiçbir kapı
 * çağrısı YOK; bilerek açık olanlar (auth, callback, pay/[token]) listede işaretlidir.
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const API = path.join(ROOT, "app", "api")

const GATES = {
  ensureCompanyAccess: /\bensureCompanyAccess\s*\(/,
  ensureCompanyWrite: /\bensureCompanyWrite\s*\(/,
  requireSuperAdmin: /\brequireSuperAdmin\s*\(/,
  requireBlogEditor: /\brequireBlogEditor\s*\(/,
  session: /\b(getServerSession|getCurrentUser|getUserContext|getSession)\s*\(/,
  cronSecret: /CRON_SECRET|x-cron-secret|authorization.*bearer/i,
  webhookHash: /paytr_token|hash|signature|verifyWebhook|merchant_salt/i,
  rateLimit: /rateLimit|isLoginLocked|recordLoginFailure|verifyRecaptcha/,
}

/** Bilerek oturumsuz çalışan uçlar (kayıt/giriş, ödeme geri çağrısı, davet, sağlık). */
const PUBLIC_BY_DESIGN = new Set([
  "auth/[...nextauth]", "auth/signin", "auth/signup", "auth/forgot-password", "auth/reset-password",
  "auth/lock-status", "paytr/callback", "billing/paytr/callback", "kontor/paytr/callback",
  "pay/[token]", "invitations/[token]", "health/db", "blog", "blog/[id]", "plans", "billing/pricing",
  "billing/packages", "billing/packages/[id]", "kontor/packages", "kontor/packages/[id]", "kontor/tariffs",
  "discount-codes/validate", "kur",
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === "route.ts") out.push(p)
  }
  return out
}

export function inventory() {
  const rows = []
  for (const file of walk(API).sort()) {
    const rel = path.relative(API, path.dirname(file)).split(path.sep).join("/")
    const src = fs.readFileSync(file, "utf8")
    const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])
    const reexport = [...src.matchAll(/export\s*\{\s*([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()))
    for (const m of reexport) if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(m) && !methods.includes(m)) methods.push(m)
    const constExport = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])
    for (const m of constExport) if (!methods.includes(m)) methods.push(m)
    const gates = Object.entries(GATES).filter(([, re]) => re.test(src)).map(([k]) => k)
    const params = [...new Set([...src.matchAll(/searchParams\.(?:get|getAll|has)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]))]
    const segments = [...rel.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)].map((m) => m[2])
    const companyIdIn = /searchParams\.get\(\s*["']companyId["']/.test(src)
      ? "query"
      : /body\.companyId|companyId\s*[:,}]|\{[^}]*\bcompanyId\b[^}]*\}\s*=\s*(await\s+)?(request|req)\.json/.test(src)
        ? "body"
        : null
    rows.push({
      path: rel,
      file: path.relative(ROOT, file).split(path.sep).join("/"),
      methods,
      gates,
      params,
      segments,
      companyIdIn,
      publicByDesign: PUBLIC_BY_DESIGN.has(rel),
      ungated: gates.length === 0 && !PUBLIC_BY_DESIGN.has(rel),
      loc: src.split("\n").length,
    })
  }
  return rows
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
if (isMain || process.argv[1]?.endsWith("envanter.mjs")) {
  const rows = inventory()
  if (process.argv.includes("--json")) {
    const out = path.join(ROOT, "scripts", "uctan-uca", "envanter.json")
    fs.writeFileSync(out, JSON.stringify(rows, null, 2))
    console.log(`${rows.length} uç → ${path.relative(ROOT, out)}`)
  } else {
    const byGate = {}
    for (const r of rows) for (const g of r.gates.length ? r.gates : ["(yok)"]) byGate[g] = (byGate[g] || 0) + 1
    console.log(`Uç: ${rows.length}  Metot: ${rows.reduce((s, r) => s + r.methods.length, 0)}  Query anahtarı: ${rows.reduce((s, r) => s + r.params.length, 0)}`)
    console.log("Kapı dağılımı:", byGate)
    const ungated = rows.filter((r) => r.ungated)
    console.log(`\nKAPISIZ (${ungated.length}):`)
    for (const r of ungated) console.log(`  ${r.path.padEnd(48)} ${r.methods.join(",")}`)
    const noMethod = rows.filter((r) => r.methods.length === 0)
    if (noMethod.length) console.log(`\nMetot bulunamadı (${noMethod.length}):`, noMethod.map((r) => r.path))
    const noCompany = rows.filter((r) => r.gates.includes("ensureCompanyAccess") && !r.companyIdIn)
    console.log(`\nensureCompanyAccess var ama companyId kaynağı çözülemedi (${noCompany.length}):`)
    for (const r of noCompany) console.log(`  ${r.path}`)
  }
}
