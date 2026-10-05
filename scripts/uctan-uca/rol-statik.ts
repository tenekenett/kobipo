/**
 * ROL STATİK TARAMASI — "bu sayfa YALNIZ kendi yetkisiyle çalışır mı?"
 *
 *   npx tsx scripts/uctan-uca/rol-statik.ts [--json]
 *
 * Her panel sayfasının kodundan (yerel importlarıyla birlikte) API çağrılarını çıkarır ve
 * kullanıcıya YALNIZ o sayfa verilmiş gibi kapı kararını sorar:
 *   - okuma (GET) "Görüntüle" ile geçmeli,
 *   - yazma (POST/PUT/PATCH/DELETE) "Düzenle" ile geçmeli.
 * Geçmeyen çağrı, sayfanın BAŞKA bir sayfanın yetkisine gizlice muhtaç olduğu yerdir —
 * 2026-10-05'teki hata tam buydu: fatura editörü firma kartını okumak için "Firma
 * Bilgileri" yetkisine muhtaçtı, kısıtlı çalışanda fatura sessizce MANUAL kaydedildi.
 *
 * Kapı monotondur (izinli sayfalardan BİRİ yeterli), dolayısıyla "yalnız kendi sayfası"
 * ile geçen çağrı her rol/profil bileşiminde geçer; tek sayfalık profil en sıkı sınamadır.
 *
 * Tarayıcı taramasının (rol-taramasi.ts) TAMAMLAYICISIDIR: o, yalnız açılışta atılan
 * istekleri görür; bu, butonla tetiklenen (Kaydet, Sil…) çağrıları da görür. Statik
 * olduğu için aday üretir — bir çağrı ekranda başka bir yetkiyle gizleniyor olabilir
 * (ör. "Yeni cari ekle" yalnız cari yetkisi olana çıkar); adaylar elle doğrulanır.
 *
 * `${…}` içeren adresler "x" segmentine çevrilir: 2026-08-20 ölçümü
 * `/api/companies/${id}` çağrılarını firma LİSTESİ ucu sanıp saymamıştı.
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const PAGES_DIR = path.join(ROOT, "app", "(dashboard)")

/** Kuralı TANIMLAYAN dosyalar: içlerindeki /api/ metinleri çağrı değil (2026-08-20 notu). */
const SKIP_FILE = [
  /^lib\/page-access\.ts$/,
  /^lib\/module-access\.ts$/,
  /^lib\/middleware\//,
  /^lib\/nav\//,
  /^lib\/db\//,
  /\.server\.tsx?$/,
  /\.test\.tsx?$/,
]

/**
 * Menüde karşılığı olmayan ama bir menü sayfasından girilen ekranlar: kapıya tabi
 * değiller (sayfa kapısı onları bilmez), ama çağırdıkları UÇLAR kapıya tabidir —
 * kullanıcı oraya hangi sayfanın yetkisiyle geliyorsa o yetkiyle çalışmalılar.
 */
const ENTRY_OWNERS: Record<string, string[]> = {
  "/e-donusum": ["/satis/fatura", "/alis/fatura"],
  "/e-donusum/x": ["/satis/fatura", "/alis/fatura"],
  "/e-donusum/x/duzenle": ["/satis/fatura", "/alis/fatura"],
}

type Call = { url: string; methods: string[]; file: string }

function stripComments(src: string): string {
  // Blok yorumlar + satır sonu yorumları (":" öncesindeki // URL'dir, dokunulmaz).
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
}

/** Tırnaklı/şablon metinlerdeki /api/ adresleri ve yakınındaki `method:` değerleri. */
function extractCalls(src: string, file: string): Call[] {
  const code = stripComments(src)
  const calls: Call[] = []
  const re = /(["'`])\/api\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const quote = m[1]
    let i = m.index + 1
    let depth = 0
    let raw = ""
    for (; i < code.length; i++) {
      const ch = code[i]
      if (quote === "`" && ch === "$" && code[i + 1] === "{") {
        depth++
        raw += "${"
        i++
        continue
      }
      if (depth > 0) {
        if (ch === "{") depth++
        if (ch === "}") depth--
        if (depth === 0) raw += "}"
        continue
      }
      if (ch === quote) break
      raw += ch
    }
    const url = normalize(raw)
    // `method:` yalnız bu çağrının seçenek nesnesinde aranır: bir sonraki fetch/adres öncesi.
    const tail = code.slice(i, i + 700)
    const stop = tail.search(/fetch\(|["'`]\/api\//)
    const window = stop > 0 ? tail.slice(0, stop) : tail
    const methodExpr = window.match(/method\s*:\s*([^,}\n]+)/)?.[1] ?? ""
    const methods = [...methodExpr.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)["'`]/gi)].map((x) => x[1].toUpperCase())
    calls.push({ url, methods: methods.length > 0 ? [...new Set(methods)] : ["GET"], file })
  }
  return calls
}

function normalize(raw: string): string {
  return (
    raw
      .replace(/\$\{[^}]*\}/g, "x") // ${id} → x
      .split(/[?#]/)[0]
      // "/api/stok/" + id gibi birleştirmede adres eğik çizgiyle biter; kural ön ekle eşleşir.
      .replace(/\/+$/, "") || "/api"
  )
}

// ---- Uç → route dosyası: yalnız kapıyı GERÇEKTEN çağıran uç sınanır ----------------
// (lib/page-api-coverage.test.ts ile aynı ölçüt; ör. `GET /api/companies` firma LİSTESİ
// kapıyı hiç çağırmaz, kural tablosu onu bağlamaz.)
const GATE_RE =
  /ensureCompanyAccess|ensureCompanyWrite|ensureCompanyExport|assertPagePath|sessionWriteActor|sessionReadAuthorize|muhasebeGirisi/
type ApiRoute = { segs: string[]; gated: boolean; methods: Set<string>; file: string }
const API_ROUTES: ApiRoute[] = []
;(function walkApi(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkApi(full)
    else if (e.name === "route.ts") {
      const src = fs.readFileSync(full, "utf8")
      const segs = path
        .relative(path.join(ROOT, "app", "api"), path.dirname(full))
        .split(path.sep)
        .filter((x) => x && !(x.startsWith("(") && x.endsWith(")")))
      const methods = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]))
      API_ROUTES.push({ segs, gated: GATE_RE.test(src), methods, file: path.relative(ROOT, full) })
    }
  }
})(path.join(ROOT, "app", "api"))

/** Next yönlendirme önceliğiyle: sabit segment dinamikten önce gelir. */
function routeFor(url: string): ApiRoute | null {
  const parts = url.replace(/^\/api\/?/, "").split("/").filter(Boolean)
  let best: { r: ApiRoute; score: number } | null = null
  for (const r of API_ROUTES) {
    const catchAll = r.segs.length > 0 && r.segs[r.segs.length - 1].startsWith("[...")
    if (catchAll ? parts.length < r.segs.length - 1 : parts.length !== r.segs.length) continue
    let score = 0
    let ok = true
    r.segs.forEach((seg, i) => {
      if (seg.startsWith("[...")) return
      if (seg.startsWith("[")) return
      if (seg === parts[i]) score += 1
      else ok = false
    })
    if (ok && (!best || score > best.score)) best = { r, score }
  }
  return best?.r ?? null
}

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

// ---- İsimli import takibi --------------------------------------------------------
// Bir modülden yalnız gerçekten alınan export'un (ve onun kullandığı iç bildirimlerin)
// içindeki adresler sayılır — 2026-08-20 ölçümünün kuralı. Aksi halde onlarca hook
// barındıran `lib/swr/use-company-data.ts` gibi bir modül, tek hook'unu kullanan her
// sayfaya bütün uçlarını yazardı.

type Decl = { name: string; text: string }
const declCache = new Map<string, Decl[]>()

/** Üst düzey bildirimler (sütun 0'da başlayan function/const/let/class). */
function declsOf(file: string): Decl[] {
  if (declCache.has(file)) return declCache.get(file)!
  const src = stripComments(fs.readFileSync(file, "utf8"))
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm
  const starts: Array<{ name: string; at: number; isDefault: boolean }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index, isDefault: /^export\s+default\b/.test(m[0]) })
  const decls: Decl[] = []
  starts.forEach((d, i) => {
    const text = src.slice(d.at, starts[i + 1]?.at ?? src.length)
    decls.push({ name: d.name, text })
    if (d.isDefault) decls.push({ name: "default", text })
  })
  declCache.set(file, decls)
  return decls
}

type ImportEdge = { file: string; names: Set<string> | "ALL"; locals: string[] }
const importCache = new Map<string, ImportEdge[]>()

function importsOf(file: string): ImportEdge[] {
  if (importCache.has(file)) return importCache.get(file)!
  const src = stripComments(fs.readFileSync(file, "utf8"))
  const edges: ImportEdge[] = []
  const push = (spec: string, names: Set<string> | "ALL", locals: string[]) => {
    const target = resolveImport(file, spec)
    if (!target || SKIP_FILE.some((re) => re.test(path.relative(ROOT, target).replace(/\\/g, "/")))) return
    edges.push({ file: target, names, locals })
  }
  for (const x of src.matchAll(/import\s+(type\s+)?([^;"'`]*?)\s+from\s*["']([^"']+)["']/g)) {
    if (x[1]) continue // import type: çalışma anında çağrı üretmez
    const clause = x[2].trim()
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (ns) {
      push(x[3], "ALL", [ns[1]])
      continue
    }
    const names = new Set<string>()
    const locals: string[] = []
    const def = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)
    if (def) {
      names.add("default")
      locals.push(def[1])
    }
    const named = clause.match(/\{([^}]*)\}/)
    for (const part of named ? named[1].split(",") : []) {
      const item = part.trim()
      if (!item || item.startsWith("type ")) continue
      const [orig, alias] = item.split(/\s+as\s+/)
      names.add(orig.trim())
      locals.push((alias ?? orig).trim())
    }
    if (names.size > 0) push(x[3], names, locals)
  }
  for (const x of src.matchAll(/export\s+\{([^}]*)\}\s+from\s*["']([^"']+)["']/g)) {
    const names = new Set(x[1].split(",").map((p) => p.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean))
    push(x[2], names, [...names])
  }
  for (const x of src.matchAll(/export\s+\*\s+from\s*["']([^"']+)["']/g)) push(x[1], "ALL", [])
  for (const x of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) push(x[1], "ALL", [])
  for (const x of src.matchAll(/^import\s+["']([^"']+)["']/gm)) push(x[1], "ALL", [])
  importCache.set(file, edges)
  return edges
}

/**
 * Dosyanın İSTENEN bölümü: istenen bildirimler + onların adıyla andığı iç bildirimler
 * (sabit noktaya kadar). "ALL" ise dosyanın tamamı.
 */
function selectText(file: string, want: Set<string> | "ALL"): string {
  if (want === "ALL") return stripComments(fs.readFileSync(file, "utf8"))
  const decls = declsOf(file)
  const chosen = new Set<string>()
  const queue = [...want]
  while (queue.length) {
    const name = queue.pop()!
    if (chosen.has(name)) continue
    chosen.add(name)
    const text = decls.filter((d) => d.name === name).map((d) => d.text).join("\n")
    for (const d of decls) if (!chosen.has(d.name) && new RegExp(`\\b${d.name.replace(/\$/g, "\\$")}\\b`).test(text)) queue.push(d.name)
  }
  return decls.filter((d) => chosen.has(d.name)).map((d) => d.text).join("\n")
}

/** Sayfadan başlayıp yalnız KULLANILAN bölümleri izleyerek çağrıları toplar. */
function callsFrom(entry: string): Call[] {
  const want = new Map<string, Set<string> | "ALL">([[entry, "ALL"]])
  const done = new Map<string, string>() // dosya → işlenmiş seçim imzası
  const calls: Call[] = []
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    const sel = want.get(file)!
    const sig = sel === "ALL" ? "ALL" : [...sel].sort().join(",")
    if (done.get(file) === sig) continue
    done.set(file, sig)
    const text = selectText(file, sel)
    calls.push(...extractCalls(text, path.relative(ROOT, file)))
    for (const edge of importsOf(file)) {
      // Kısmi seçimde yalnız seçilen metinde ADI GEÇEN import izlenir.
      if (sel !== "ALL" && edge.locals.length > 0 && !edge.locals.some((l) => new RegExp(`\\b${l.replace(/\$/g, "\\$")}\\b`).test(text))) continue
      const prev = want.get(edge.file)
      const next: Set<string> | "ALL" =
        prev === "ALL" || edge.names === "ALL" ? "ALL" : new Set([...(prev ?? []), ...edge.names])
      want.set(edge.file, next)
      stack.push(edge.file)
    }
  }
  return calls
}

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) pageFiles(full, out)
    else if (e.name === "page.tsx") out.push(full)
  }
  return out
}

function routeOf(file: string): string {
  const segs = path
    .relative(PAGES_DIR, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => (s.startsWith("[") ? "x" : s))
  return "/" + segs.join("/")
}

async function main() {
  const access = await import("../../lib/page-access")
  const pages = await import("../../lib/nav/pages")

  type Gap = { route: string; owner: string; url: string; method: string; need: "Görüntüle" | "Düzenle"; required: string[]; files: string[] }
  const gaps = new Map<string, Gap>()
  let routes = 0
  let callCount = 0

  for (const file of pageFiles(PAGES_DIR)) {
    const route = routeOf(file)
    const owners = ENTRY_OWNERS[route] ?? access.navHrefsForPath(route)
    if (owners.length === 0) continue // sayfa kapısına tabi olmayan ekran (bkz. ROUTE_OWNERS)
    routes++
    const calls = callsFrom(file)
    callCount += calls.length
    for (const owner of owners) {
      // Yalnız bu sayfa: hazır rollerin tavanı en geniş olan ADMIN, liste tek sayfa.
      const view = { role: "ADMIN", allowedPaths: [owner], writablePaths: [] }
      const edit = { role: "ADMIN", allowedPaths: [owner], writablePaths: [owner] }
      for (const c of calls) {
        const api = routeFor(c.url)
        if (!api || !api.gated) continue // kapısız uç: sayfa kuralı onu bağlamaz
        for (const method of c.methods) {
          if (!api.methods.has(method)) continue
          const isWrite = method !== "GET"
          const perms = isWrite ? edit : view
          if (access.isApiPathAllowedForUser(c.url, method, perms)) continue
          const key = `${route}|${owner}|${method} ${c.url}`
          const gap = gaps.get(key) ?? {
            route,
            owner,
            url: c.url,
            method,
            need: isWrite ? ("Düzenle" as const) : ("Görüntüle" as const),
            required: access.requiredPagesForApiPath(c.url, method),
            files: [],
          }
          if (!gap.files.includes(c.file)) gap.files.push(c.file)
          gaps.set(key, gap)
        }
      }
    }
  }

  const list = [...gaps.values()].sort((a, b) => a.owner.localeCompare(b.owner) || a.url.localeCompare(b.url))
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(list, null, 2))
    return
  }
  console.log(`${routes} kapılı ekran · ${callCount} çağrı · ${list.length} aday boşluk\n`)
  if (process.argv.includes("--ozet")) {
    const bySource = new Map<string, number>()
    for (const g of list) for (const f of g.files) bySource.set(f, (bySource.get(f) ?? 0) + 1)
    console.log("kaynağa göre:")
    for (const [f, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${f}`)
    const byMethod = new Map<string, number>()
    for (const g of list) byMethod.set(g.need, (byMethod.get(g.need) ?? 0) + 1)
    console.log("türe göre:", Object.fromEntries(byMethod))
    return
  }
  const label = (h: string) => pages.navPage(h)?.label ?? h
  for (const g of list) {
    console.log(
      `${label(g.owner)} [${g.need}] ${g.route} → ${g.method} ${g.url}\n` +
        `    gereken: ${g.required.map(label).join(", ") || "(kuralsız uç: yazma kapalı)"}\n` +
        `    kaynak: ${g.files.slice(0, 3).join(", ")}${g.files.length > 3 ? " …" : ""}`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
