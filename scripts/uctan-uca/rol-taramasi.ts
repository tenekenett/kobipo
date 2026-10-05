/**
 * ROL TARAMASI — her rol/izin profili, izinli her ekranı GERÇEK tarayıcıda açar.
 *
 *   1) Dev sunucusu:  npx next dev -p 3005 -H 127.0.0.1
 *   2) npx tsx scripts/uctan-uca/rol-taramasi.ts [seçenekler]
 *
 * Seçenekler:
 *   --profil=<regex>   yalnız anahtarı eşleşen profiller (ör. --profil=^sablon)
 *   --sayfa=<regex>    yalnız href'i eşleşen sayfalar
 *   --eszamanli=N      aynı anda kaç profil (varsayılan 3)
 *   --yasak=N          profil başına denenecek YASAK sayfa sayısı (varsayılan 3)
 *   --tut              test kullanıcı/rollerini silme (tarayıcıda elle bakmak için)
 *   --temizle          yalnız kalıntıları sil ve çık
 *
 * NEDEN (2026-10-05): kısıtlı bir çalışanın fatura editörü firma kartını okuyamadı — uç
 * 403 döndü, ekran hatayı yuttu ve faturayı MANUAL kaydetti. Kapı testleri yalnız ADMIN'i
 * ölçtüğü için hiçbir test görmedi. Bu tarama her profil için izinli her sayfayı açar ve
 * sayfanın KENDİ çağırdığı uçlardan 401/403/5xx dönen var mı bakar; yasak sayfaların
 * gerçekten kapalı olduğunu da dener.
 *
 * GÜVENLİK
 *  - Sayfa açılışında atılan YAZMA istekleri (POST/PUT/PATCH/DELETE) tarayıcıda kesilir
 *    (418) ve rapora yazılır: tarama veri yazmaz, GİB'e/Mysoft'a belge göndermez.
 *  - Firmanın tüm `companyId`li tablolarının satır sayısı önce/sonra karşılaştırılır.
 *  - Test kullanıcıları `oto-rol-*@kobipo.test` (şifresiz, giriş yapamaz), test rolleri
 *    `[OTO] …`; tarama sonunda (hata olsa da) silinir. Firmanın kendi rollerine yalnız
 *    test üyesi bağlanır, rolün kendisine dokunulmaz.
 *  - Oturum NextAuth `encode` ile üretilen JWT çerezidir (scripts/uctan-uca/tarama.mjs
 *    ile aynı yol); giriş ekranı/captcha kullanılmaz.
 *
 * Çıktı: scripts/uctan-uca/rol-sonuc.json + docs/denetim/<tarih>-ROL-TARAMASI.md
 *        (--profil/--sayfa süzgeçli koşuda rapor scripts/uctan-uca/rol-sonuc.md'ye yazılır)
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { config as loadEnv } from "dotenv"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env", quiet: true })
loadEnv({ path: ".env.local", override: true, quiet: true })

const BASE = (process.env.TEST_BASE_URL || "http://127.0.0.1:3005").replace(/\/$/, "")
const FIRMA = process.env.ROL_TARAMA_FIRMA || "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı (test)
const CHROME = process.env.CHROME_BIN || "/usr/bin/google-chrome-stable"
const EMAIL_PREFIX = "oto-rol-"
const EMAIL_DOMAIN = "@kobipo.test"
const ROLE_PREFIX = "[OTO] "
const COOKIE = "next-auth.session-token"

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const PROFIL_RE = opt("profil") ? new RegExp(opt("profil")!) : null
const SAYFA_RE = opt("sayfa") ? new RegExp(opt("sayfa")!) : null
const CONCURRENCY = Number(opt("eszamanli") ?? 3)
const FORBIDDEN_SAMPLE = Number(opt("yasak") ?? 3)
/** Teşhis: URL'si eşleşen isteklerin CDP olaylarını stderr'e yazar (ROL_TARAMA_DEBUG=regex). */
const DEBUG_RE = process.env.ROL_TARAMA_DEBUG ? new RegExp(process.env.ROL_TARAMA_DEBUG) : null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Chrome DevTools Protocol — bağımlılıksız, Node'un yerleşik WebSocket'i ile
// ---------------------------------------------------------------------------

type Handler = (method: string, params: any) => void

class Cdp {
  private seq = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, Handler>()

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else p.resolve(msg.result)
      } else if (msg.sessionId) {
        this.handlers.get(msg.sessionId)?.(msg.method, msg.params)
      }
    })
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true })
      ws.addEventListener("error", reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  on(sessionId: string, handler: Handler) {
    this.handlers.set(sessionId, handler)
  }

  close() {
    this.ws.close()
  }
}

async function launchChrome(): Promise<{ proc: ChildProcess; wsUrl: string; dir: string }> {
  // Geçici Chrome profili; ROL_TARAMA_TMP ile başka yere alınabilir (TMPDIR'i uzun bir
  // yola çevirmek tsx'in IPC soketini bozar — Unix soket yolu ~108 karakterle sınırlı).
  const dir = fs.mkdtempSync(path.join(process.env.ROL_TARAMA_TMP || os.tmpdir(), "rol-taramasi-"))
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--window-size=1440,900",
    ...(process.env.CHROME_NO_SANDBOX ? ["--no-sandbox"] : []),
    "about:blank",
  ]
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] })
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => reject(new Error(`Chrome açılmadı:\n${buf.slice(-800)}`)), 30_000)
    proc.stderr!.on("data", (d) => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    proc.on("exit", (code) => reject(new Error(`Chrome kapandı (${code}):\n${buf.slice(-800)}`)))
  })
  return { proc, wsUrl, dir }
}

// ---------------------------------------------------------------------------
// Sekme: bir profilin tarayıcı bağlamı + ağ kaydı
// ---------------------------------------------------------------------------

type ApiHit = { method: string; url: string; status: number; code?: string; error?: string }

type Visit = {
  href: string
  finalPath: string
  finalSearch: string
  text: string
  api: ApiHit[]
  blockedWrites: Array<{ method: string; url: string }>
  exceptions: string[]
  timedOut: boolean
  /** Ağ susmadıysa hâlâ bekleyen istekler (teşhis için). */
  stuck: string[]
}

/** Bitmeyen istekler (HMR, akış) ağ sessizliğini beklemeyi kilitlemesin. */
const IGNORED_URL = /webpack-hmr|turbopack-hmr|__nextjs|\/_next\/static\/.*hot-update|^data:|^blob:|^chrome-extension:/
const isApi = (url: string) => /^https?:\/\/[^/]+\/api\//.test(url)

class Tab {
  /** Bekleyen istek → başlama anı. */
  private inflight = new Map<string, number>()
  private requests = new Map<string, { method: string; url: string }>()
  private errorBodies = new Map<string, ApiHit>()
  private bodyFetches: Promise<unknown>[] = []
  private lastActivity = Date.now()
  private loadWaiters: Array<() => void> = []
  private visit!: Omit<Visit, "href" | "finalPath" | "finalSearch" | "text" | "timedOut" | "stuck">

  private constructor(
    private cdp: Cdp,
    private sessionId: string,
    readonly contextId: string
  ) {
    cdp.on(sessionId, (method, params) => this.onEvent(method, params))
  }

  static async open(cdp: Cdp, cookie: string): Promise<Tab> {
    const { browserContextId } = await cdp.send("Target.createBrowserContext", { disposeOnDetach: true })
    const host = new URL(BASE).hostname
    await cdp.send("Storage.setCookies", {
      browserContextId,
      cookies: [{ name: COOKIE, value: cookie, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }],
    })
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId })
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const tab = new Tab(cdp, sessionId, browserContextId)
    await Promise.all([
      cdp.send("Network.enable", {}, sessionId),
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Runtime.enable", {}, sessionId),
      // Açılışta yazma KESİLİR: tarama veri yazmaz (bkz. dosya başı).
      cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] }, sessionId),
    ])
    return tab
  }

  private send(method: string, params: object = {}) {
    return this.cdp.send(method, params, this.sessionId)
  }

  private onEvent(method: string, p: any) {
    if (DEBUG_RE) {
      const url = p?.request?.url ?? p?.response?.url ?? this.requests.get(p?.requestId)?.url ?? ""
      if (DEBUG_RE.test(url) || (method.startsWith("Fetch.") && DEBUG_RE.test(p?.request?.url ?? ""))) {
        console.error(`[cdp] ${method} ${p?.requestId ?? ""} ${p?.networkId ?? ""} ${p?.response?.status ?? ""} ${p?.errorText ?? ""} ${p?.canceled ? "canceled" : ""} ${url}`)
      }
    }
    switch (method) {
      case "Fetch.requestPaused": {
        const m = String(p.request.method).toUpperCase()
        // Sayfa istek beklerken onu iptal ederse (ör. adres SEF kısa adına çevrilirken)
        // Chrome ağ tarafında "bitti/düştü" olayı yollamıyor; istek sonsuza dek bekliyor
        // görünüp sessizliği kilitliyordu. Devam ettirme reddedilirse istek düşürülür.
        const drop = () => {
          if (p.networkId) this.inflight.delete(p.networkId)
        }
        if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
          this.send("Fetch.continueRequest", { requestId: p.requestId }).catch(drop)
        } else {
          this.visit?.blockedWrites.push({ method: m, url: p.request.url })
          this.send("Fetch.fulfillRequest", {
            requestId: p.requestId,
            responseCode: 418,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify({ error: "rol-taramasi: açılışta yazma engellendi" })).toString("base64"),
          }).catch(drop)
        }
        break
      }
      case "Network.requestWillBeSent": {
        const url: string = p.request.url
        if (IGNORED_URL.test(url) || p.type === "WebSocket" || p.type === "EventSource") break
        // Sayfa yeniden çizilip aynı isteği tekrar atınca Chrome eskisini terk eder ama
        // (Fetch araya girdiğinde) "düştü" olayı yollamaz; eskisi sonsuza dek bekliyor
        // görünürdü. Aynı yöntem+adresle gelen yeni istek eskisinin yerine geçer.
        for (const [id] of this.inflight) {
          const prev = this.requests.get(id)
          if (prev && prev.url === url && prev.method === p.request.method) this.inflight.delete(id)
        }
        this.inflight.set(p.requestId, Date.now())
        this.requests.set(p.requestId, { method: p.request.method, url })
        this.lastActivity = Date.now()
        break
      }
      case "Network.responseReceived": {
        const url: string = p.response.url
        const status: number = p.response.status
        if (!isApi(url) || status === 418) break
        const req = this.requests.get(p.requestId)
        const hit: ApiHit = { method: req?.method ?? "GET", url, status }
        this.visit?.api.push(hit)
        if (status >= 400) this.errorBodies.set(p.requestId, hit)
        break
      }
      case "Network.loadingFinished":
      case "Network.loadingFailed": {
        this.inflight.delete(p.requestId)
        this.lastActivity = Date.now()
        const hit = this.errorBodies.get(p.requestId)
        if (hit && method === "Network.loadingFinished") {
          this.errorBodies.delete(p.requestId)
          this.bodyFetches.push(
            this.send("Network.getResponseBody", { requestId: p.requestId })
              .then((r) => {
                const body = JSON.parse(r.base64Encoded ? Buffer.from(r.body, "base64").toString() : r.body)
                hit.code = body?.code
                hit.error = typeof body?.error === "string" ? body.error.slice(0, 200) : undefined
              })
              .catch(() => {})
          )
        }
        break
      }
      case "Page.loadEventFired":
        this.loadWaiters.splice(0).forEach((resolve) => resolve())
        break
      case "Page.javascriptDialogOpening":
        this.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {})
        break
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails
        this.visit?.exceptions.push(String(d?.exception?.description ?? d?.text ?? "bilinmeyen hata").split("\n")[0])
        break
      }
    }
  }

  private waitLoad(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      this.loadWaiters.push(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  /** 20 sn'den uzun bekleyen istek kayıp sayılır (yedek eşik; teşhis için `stuck`a yazılır). */
  private activeCount(): number {
    const now = Date.now()
    return [...this.inflight.values()].filter((t) => now - t < 20_000).length
  }

  private async waitIdle(quietMs: number, maxMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      if (this.activeCount() === 0 && Date.now() - this.lastActivity >= quietMs) return true
      await sleep(150)
    }
    return false
  }

  async open(href: string): Promise<Visit> {
    this.visit = { api: [], blockedWrites: [], exceptions: [] }
    this.inflight.clear()
    this.requests.clear()
    this.errorBodies.clear()
    this.bodyFetches = []
    const url = `${BASE}${href}${href.includes("?") ? "&" : "?"}company=${FIRMA}`
    const loaded = this.waitLoad(120_000) // ilk açılışta dev sunucusu sayfayı derler
    await this.send("Page.navigate", { url })
    const okLoad = await loaded
    const idle = await this.waitIdle(1500, 30_000)
    await Promise.allSettled(this.bodyFetches)
    const { result } = await this.send("Runtime.evaluate", {
      expression:
        "JSON.stringify({ path: location.pathname, search: location.search, text: ((document.body && document.body.innerText) || '').slice(0, 6000) })",
      returnByValue: true,
    })
    const page = JSON.parse(result.value)
    const stuck = [...this.inflight.keys()].map((id) => {
      const r = this.requests.get(id)
      return r ? `${r.method} ${r.url.replace(BASE, "")}` : id
    })
    return { href, finalPath: page.path, finalSearch: page.search, text: page.text, timedOut: !okLoad || !idle, stuck, ...this.visit }
  }

  async close() {
    await this.cdp.send("Target.disposeBrowserContext", { browserContextId: this.contextId }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Profiller
// ---------------------------------------------------------------------------

type Profile = {
  key: string
  label: string
  role: string
  allowedPaths?: string[]
  writablePaths?: string[]
  /** Hazır kalıptan `[OTO] …` adıyla açılan test rolü. */
  template?: { name: string; allowedPaths: string[]; writablePaths: string[] }
  /** Firmanın MEVCUT özel rolü (adıyla); role dokunulmaz, yalnız test üyesi bağlanır. */
  existingRole?: string
}

type Finding = {
  kind: string
  profile: string
  page: string
  detail: string
  /** Aynı sayfa ADMIN'de de aynı hatayı veriyorsa yetkiyle ilgisi yok. */
  alsoAdmin?: boolean
}

const slug = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[ıi̇]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** API yolunu rapor için sadeleştirir: kök, sorgu ve id'ler atılır. */
function apiKey(url: string): string {
  const u = new URL(url)
  return u.pathname
    .split("/")
    .map((seg) => (/^c[a-z0-9]{20,}$/.test(seg) || /^[0-9a-f-]{32,36}$/.test(seg) ? ":id" : seg))
    .join("/")
}

async function main() {
  // Proje modülleri ortam yüklendikten SONRA: prisma bağlantı adresini import anında okur.
  const { prisma } = await import("../../lib/db/prisma")
  const pages = await import("../../lib/nav/pages")
  const access = await import("../../lib/page-access")
  const { DEFAULT_ROLE_TEMPLATES } = await import("../../lib/nav/role-templates")
  const { roleLabel } = await import("../../lib/auth/role-labels")

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET yok (.env.local)")

  async function cleanup(): Promise<{ users: number; roles: number; logs: number }> {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
      select: { id: true },
    })
    const ids = users.map((u) => u.id)
    const logs = await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.userCompany.deleteMany({ where: { userId: { in: ids } } })
    const roles = await prisma.companyRole.deleteMany({ where: { companyId: FIRMA, name: { startsWith: ROLE_PREFIX } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    return { users: ids.length, roles: roles.count, logs: logs.count }
  }

  if (flag("temizle")) {
    console.log("temizlendi:", await cleanup())
    await prisma.$disconnect()
    return
  }

  const company = await prisma.company.findUnique({
    where: { id: FIRMA },
    select: { name: true, branchName: true, disabledModules: true, isEDonusumEnabled: true, companyRoles: { select: { name: true } } },
  })
  if (!company) throw new Error(`firma yok: ${FIRMA}`)
  const availability = { disabledModules: company.disabledModules, isEDonusumEnabled: company.isEDonusumEnabled }

  // ---- Profil listesi ------------------------------------------------------
  const groupHrefs = (...titles: string[]) =>
    pages.NAV_GROUPS.filter((g) => titles.includes(g.title)).flatMap((g) => g.hrefs)
  const satisEdonusum = ["/dashboard", ...groupHrefs("Satış", "Stok", "Finans", "E-Dönüşüm")]

  const profiles: Profile[] = [
    ...["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"].map((role) => ({
      key: role.toLowerCase().replace("_", "-"),
      label: `${roleLabel(role)} (kısıtsız)`,
      role,
    })),
    {
      // 2026-10-05 olayının kalıbı (EREN VİNÇ): gruplar bütün olarak açık/kapalı.
      key: "kisitli-satis-edonusum",
      label: "Kısıtlı Yönetici — Satış/Stok/Finans/E-Dönüşüm, Kontör salt okunur",
      role: "ADMIN",
      allowedPaths: [...satisEdonusum, "/e-donusum/kontor"],
      writablePaths: satisEdonusum,
    },
    {
      key: "kisitli-tek-fatura",
      label: "Kısıtlı Yönetici — yalnız Satış Faturası",
      role: "ADMIN",
      allowedPaths: ["/satis/fatura"],
      writablePaths: ["/satis/fatura"],
    },
    {
      key: "kisitli-salt-okunur",
      label: "Kısıtlı Yönetici — her sayfa salt okunur",
      role: "ADMIN",
      allowedPaths: pages.pagesForRole("ADMIN"),
      writablePaths: [],
    },
    ...DEFAULT_ROLE_TEMPLATES.map((t) => ({
      key: `sablon-${t.key}`,
      label: `Şablon: ${t.name}`,
      role: "CUSTOM",
      template: { name: t.name, allowedPaths: t.allowedPaths, writablePaths: t.writablePaths },
    })),
    ...company.companyRoles
      .filter((r) => !r.name.startsWith(ROLE_PREFIX))
      .map((r) => ({ key: `mevcut-${slug(r.name)}`, label: `Firmanın rolü: ${r.name}`, role: "CUSTOM", existingRole: r.name })),
  ].filter((p) => !PROFIL_RE || PROFIL_RE.test(p.key))

  // ---- Kurulum -------------------------------------------------------------
  await cleanup() // önceki yarım kalmış taramanın kalıntısı

  // Ne olursa olsun test kullanıcıları/rolleri silinir (--tut hariç): yarıda kesilen
  // tarama firmada `oto-rol-*` üye bırakmasın.
  let cleaned: { users: number; roles: number; logs: number } | null = null
  const finalCleanup = async () => {
    if (flag("tut") || cleaned) return
    cleaned = await cleanup()
  }
  process.once("SIGINT", () => {
    console.log("\nkesildi — test kayıtları siliniyor…")
    finalCleanup().finally(() => process.exit(130))
  })
  try {

  type Ready = Profile & { userId: string; cookie: string; perms: import("../../lib/page-access").PagePermissions }
  const ready: Ready[] = []
  for (const p of profiles) {
    const email = `${EMAIL_PREFIX}${p.key}${EMAIL_DOMAIN}`
    const user = await prisma.user.create({ data: { email, name: `[OTO] ${p.label}`, password: "x" } })
    let role: { id: string; allowedPaths: string[]; writablePaths: string[] } | null = null
    if (p.template) {
      const clean = access.sanitizePagePermissions("CUSTOM", p.template.allowedPaths, p.template.writablePaths, { custom: true })
      role = await prisma.companyRole.create({
        data: { companyId: FIRMA, name: `${ROLE_PREFIX}${p.template.name}`, description: "rol-taramasi", ...clean },
        select: { id: true, allowedPaths: true, writablePaths: true },
      })
    } else if (p.existingRole) {
      role = await prisma.companyRole.findFirst({
        where: { companyId: FIRMA, name: p.existingRole },
        select: { id: true, allowedPaths: true, writablePaths: true },
      })
    }
    // Arayüzün kaydedeceği hâl: liste rolün tavanıyla kesişir, "her şey tam" kısıtsıza döner.
    const clean = role
      ? { allowedPaths: [], writablePaths: [] }
      : access.sanitizePagePermissions(p.role, p.allowedPaths ?? [], p.writablePaths ?? [])
    await prisma.userCompany.create({
      data: { userId: user.id, companyId: FIRMA, role: p.role as never, customRoleId: role?.id ?? null, ...clean },
    })
    const token = await encode({
      token: { id: user.id, email, isSuperAdmin: false, isBlogEditor: false, defaultCompanyId: FIRMA, defaultRole: p.role as never },
      secret,
    })
    const perms = role
      ? { role: "CUSTOM", allowedPaths: role.allowedPaths, writablePaths: role.writablePaths, custom: true }
      : { role: p.role, ...clean }
    ready.push({ ...p, userId: user.id, cookie: token, perms })
  }
  console.log(`${ready.length} profil hazır (${company.name}${company.branchName ? " / " + company.branchName : ""})`)
  // Güvenlik fotoğrafı test üyeleri/rolleri açıldıktan SONRA: fark yalnız taramanın
  // kendisinden gelebilir.
  const snapshotBefore = await snapshot(prisma)

  // ---- Tarama ---------------------------------------------------------------
  const chrome = await launchChrome()
  const cdp = await Cdp.connect(chrome.wsUrl)
  const findings: Finding[] = []
  const visitsLog: Array<{ profile: string; page: string; expect: "izinli" | "yasak"; ms: number; api: number; timedOut: boolean }> = []
  const blockedWrites: Array<{ profile: string; page: string; method: string; api: string }> = []
  const adminErrors = new Map<string, Set<string>>() // sayfa → "STATUS api" kümesi

  const allAvailable = pages.filterAvailablePages(pages.NAV_PAGES.map((p) => p.href), availability)
  const details = (await detailRoutes(prisma)).filter((r) => !SAYFA_RE || SAYFA_RE.test(r))

  async function crawl(p: Ready) {
    const allVisible = pages.filterAvailablePages(access.visiblePages(p.perms), availability)
    const visible = allVisible.filter((h) => !SAYFA_RE || SAYFA_RE.test(h))
    const editable = new Set(access.editablePages(p.perms))
    // Yasak havuzu SÜZGEÇSİZ izinli kümeden kurulur: --sayfa ile dışarıda kalan izinli
    // sayfa "yasak" sanılmasın.
    const pool = allAvailable.filter(
      (h) => !allVisible.includes(h) && !pages.ALWAYS_AVAILABLE_PAGES.includes(h) && (!SAYFA_RE || SAYFA_RE.test(h))
    )
    const step = pool.length / Math.max(1, FORBIDDEN_SAMPLE)
    const forbidden = Array.from({ length: Math.min(FORBIDDEN_SAMPLE, pool.length) }, (_, i) => pool[Math.floor(i * step)])

    // Detay rotası: sahiplerinden biri görünürse izinli. Sahibi kapalı modülde olan
    // rota (ör. restoran) zaten görünür listede olmaz.
    const visibleDetails = details.filter((r) => routeOwners(access, r).some((o) => allVisible.includes(o)))
    const tab = await Tab.open(cdp, p.cookie)
    try {
      for (const [href, expect] of [
        ...visible.map((h) => [h, "izinli"] as const),
        ...visibleDetails.map((h) => [h, "izinli"] as const),
        ...forbidden.map((h) => [h, "yasak"] as const),
      ]) {
        const t0 = Date.now()
        let v: Visit
        try {
          v = await tab.open(href)
        } catch (e) {
          findings.push({ kind: "tarama-hatasi", profile: p.key, page: href, detail: String((e as Error).message) })
          continue
        }
        visitsLog.push({ profile: p.key, page: href, expect, ms: Date.now() - t0, api: v.api.length, timedOut: v.timedOut })
        const owners = access.navHrefsForPath(v.finalPath, new URLSearchParams(v.finalSearch))
        const requested = href.split("?")[0]
        const isDetail = !pages.NAV_PAGES.some((n) => n.href === requested)
        const landed = isDetail
          ? v.finalPath.split("/")[1] === requested.split("/")[1] &&
            routeOwners(access, v.finalPath + v.finalSearch).join() === routeOwners(access, href).join()
          : v.finalPath === href || owners.includes(href)
        const guard = /sayfasına yetkiniz yok|Bu sayfaya yetkiniz yok/.test(v.text)
        const add = (kind: string, detail: string) => findings.push({ kind, profile: p.key, page: href, detail })

        if (expect === "yasak") {
          if (landed && !guard) add("yasak-sayfa-acildi", `yönlendirme yok, yetki ekranı yok (son adres ${v.finalPath})`)
          if (v.timedOut) add("zaman-asimi", `ağ susmadı; bekleyen: ${v.stuck.slice(0, 4).join(", ") || "—"}`)
          continue
        }
        const cariHidden = v.api.some((h) => h.code === "CARI_FORBIDDEN")
        if (!landed && !cariHidden) add("izinli-sayfa-yonlendirildi", `${href} → ${v.finalPath}${v.finalSearch}`)
        if (guard) add("izinli-sayfada-yetki-ekrani", v.text.slice(0, 160).replace(/\s+/g, " "))
        if (/modülü kapalı|Bu modül kapalı/.test(v.text)) add("modul-kapali-ekrani", "")
        const writable = routeOwners(access, href).some((o) => editable.has(o))
        if (/salt-okunur açılamaz/.test(v.text) && (isDetail ? writable : editable.has(href)))
          add("duzenlenebilir-sayfada-salt-okunur-duvar", "")
        if (/Unhandled Runtime Error|Application error|Something went wrong/.test(v.text)) add("sayfa-coktu", v.text.slice(0, 200))
        if (v.timedOut) add("zaman-asimi", `ağ susmadı; bekleyen: ${v.stuck.slice(0, 4).join(", ") || "—"}`)
        else if (v.stuck.length > 0) add("askida-istek", v.stuck.slice(0, 4).join(", "))
        for (const e of [...new Set(v.exceptions)]) add("js-hatasi", e.slice(0, 200))
        for (const hit of v.api) {
          if (hit.status < 400) continue
          const key = `${hit.status} ${hit.method} ${apiKey(hit.url)}`
          if (p.key === "admin") adminErrors.set(href, (adminErrors.get(href) ?? new Set()).add(key))
          const kind =
            hit.code === "CARI_FORBIDDEN"
              ? // Tasarım gereği: kısıtlı rol yalnız kendisine atanmış cariyi görür (CLAUDE.md
                // "Cari görünürlüğü"); tarama atanmamış bir cari kartı açar.
                "beklenen-cari-gorunurlugu"
              : hit.code === "PAGE_FORBIDDEN"
              ? "api-sayfa-kapisi-reddi"
              : hit.code === "MODULE_LOCKED"
                ? "api-modul-kilidi"
                : hit.status === 401 || hit.status === 403
                  ? "api-yetki-reddi"
                  : hit.status === 404
                    ? "api-404"
                    : "api-sunucu-hatasi"
          add(kind, `${key}${hit.code ? ` [${hit.code}]` : ""}${hit.error ? ` — ${hit.error}` : ""}`)
        }
        for (const w of v.blockedWrites) blockedWrites.push({ profile: p.key, page: href, method: w.method, api: apiKey(w.url) })
      }
    } finally {
      await tab.close()
    }
    process.stdout.write(
      `  ✓ ${p.key} (${visible.length} izinli + ${visibleDetails.length} detay + ${forbidden.length} yasak sayfa)\n`
    )
  }

  try {
    // ADMIN kuyruğun başında: en çok sayfayı o açar (dev sunucusu sayfayı ilk açılışta
    // derler). "ADMIN'de de var" karşılaştırması tarama BİTİNCE yapılır, sıra şart değil.
    const queue = [...ready].sort((a, b) => Number(b.key === "admin") - Number(a.key === "admin"))
    let i = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < queue.length) await crawl(queue[i++])
      })
    )
  } finally {
    cdp.close()
    chrome.proc.kill("SIGKILL")
    fs.rmSync(chrome.dir, { recursive: true, force: true })
  }

  for (const f of findings) {
    if (f.profile !== "admin" && f.kind.startsWith("api-")) {
      const key = f.detail.split(" [")[0].split(" — ")[0]
      f.alsoAdmin = adminErrors.get(f.page)?.has(key) ?? false
    }
  }

  // ---- Günlük + güvenlik karşılaştırması + temizlik ----------------------------
  const forbiddenLogs = await prisma.systemLog.findMany({
    where: { action: "PAGE_FORBIDDEN", userId: { in: ready.map((p) => p.userId) } },
    select: { details: true, user: { select: { email: true } } },
  })
  const snapshotAfter = await snapshot(prisma)
  const rowDiffs = Object.keys({ ...snapshotBefore, ...snapshotAfter })
    .filter((t) => (snapshotBefore[t] ?? 0) !== (snapshotAfter[t] ?? 0))
    .map((t) => ({ table: t, before: snapshotBefore[t] ?? 0, after: snapshotAfter[t] ?? 0 }))
  await finalCleanup()

  const result = {
    at: new Date().toISOString(),
    base: BASE,
    company: { id: FIRMA, name: company.name, availability },
    profiles: ready.map((p) => ({ key: p.key, label: p.label, role: p.role })),
    visits: visitsLog,
    findings,
    blockedWrites,
    forbiddenLogs: forbiddenLogs.map((l) => ({ user: l.user?.email, details: l.details })),
    rowDiffs,
    cleaned,
  }
  fs.writeFileSync("scripts/uctan-uca/rol-sonuc.json", JSON.stringify(result, null, 2))
  // Süzgeçli (kısmi) koşu günün denetim raporunu EZMEZ: bir sayfayı yeniden ölçmek
  // tam taramanın kaydını 5 satırlık bir rapora çevirirdi.
  const reportPath = PROFIL_RE || SAYFA_RE
    ? "scripts/uctan-uca/rol-sonuc.md"
    : `docs/denetim/${new Date().toISOString().slice(0, 10)}-ROL-TARAMASI.md`
  fs.writeFileSync(reportPath, report(result))
  console.log(`\n${visitsLog.length} sayfa açıldı · ${findings.length} bulgu · satır farkı ${rowDiffs.length} tablo`)
  console.log(`rapor: ${reportPath} · ham sonuç: scripts/uctan-uca/rol-sonuc.json`)
  } finally {
    await finalCleanup()
    await prisma.$disconnect()
  }
}

/**
 * Menü sayfası OLMAYAN ama bir menü sayfasının yetkisiyle girilen ekranlar: editör,
 * önizleme, kartlar. 2026-10-05 hatası tam burada (fatura editörü) yaşandı; yalnız
 * menü sayfalarını gezen tarama onu göremezdi. Kimlikler firmanın gerçek kayıtlarından.
 */
async function detailRoutes(prisma: any): Promise<string[]> {
  const one = (model: any, where: object = {}) =>
    model.findFirst({ where: { companyId: FIRMA, ...where }, orderBy: { createdAt: "desc" }, select: { id: true } })
  const [sale, purchase, draft, customer, supplier, product, employee, quote, receipt, account] = await Promise.all([
    one(prisma.invoice, { type: "SALES", isReceipt: false }),
    one(prisma.invoice, { type: "PURCHASE", isReceipt: false }),
    one(prisma.invoice, { type: "SALES", isReceipt: false, status: "DRAFT" }),
    one(prisma.customer),
    one(prisma.supplier),
    one(prisma.product),
    one(prisma.employee),
    one(prisma.quote),
    one(prisma.invoice, { isReceipt: true }),
    one(prisma.financialAccount),
  ])
  return [
    "/e-donusum/yeni",
    "/e-donusum/yeni?type=PURCHASE",
    sale && `/faturalar/${sale.id}/onizleme`,
    purchase && `/faturalar/${purchase.id}/onizleme`,
    draft && `/e-donusum/${draft.id}/duzenle`,
    customer && `/cari/customers/${customer.id}`,
    supplier && `/cari/suppliers/${supplier.id}`,
    product && `/stok/${product.id}`,
    employee && `/personel/${employee.id}`,
    quote && `/teklif/${quote.id}`,
    receipt && `/fisler/${receipt.id}`,
    account && `/finans/kanallar/${account.id}`,
  ].filter((r): r is string => Boolean(r))
}

/**
 * Detay rotasının sahibi. Menüsüz ve sahipsiz fatura ekranları (`/e-donusum/<id>/duzenle`)
 * fatura listelerinden girilir; o yetkiyle çalışmaları beklenir.
 */
function routeOwners(access: any, route: string): string[] {
  const [pathname, query] = route.split("?")
  const owners = access.navHrefsForPath(pathname, new URLSearchParams(query ?? ""))
  if (owners.length > 0) return owners
  return pathname.startsWith("/e-donusum/") ? ["/satis/fatura", "/alis/fatura"] : []
}

/** Firmanın `companyId`li tablolarının satır sayısı (log tabloları hariç). */
async function snapshot(prisma: any): Promise<Record<string, number>> {
  const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
    `select table_name from information_schema.columns where table_schema='public' and column_name='companyId' order by 1`
  )
  const skip = new Set(["system_logs", "access_logs", "automation_card_events", "notifications", "cron_runs", "subscription_events", "usage_limits", "login_attempts"])
  const union = tables
    .filter((t) => !skip.has(t.table_name))
    .map((t) => `select '${t.table_name}' as t, count(*)::int as n from public."${t.table_name}" where "companyId" = '${FIRMA}'`)
    .join(" union all ")
  const rows: Array<{ t: string; n: number }> = await prisma.$queryRawUnsafe(union)
  return Object.fromEntries(rows.map((r) => [r.t, r.n]))
}

function report(r: any): string {
  const byKind = new Map<string, any[]>()
  for (const f of r.findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
  const lines = [
    `# Rol taraması — ${r.at.slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Firma: **${r.company.name}** (\`${r.company.id}\`) · ${r.profiles.length} profil · ${r.visits.length} sayfa açılışı · araç: \`scripts/uctan-uca/rol-taramasi.ts\``,
    "",
    "## Profiller",
    "",
    ...r.profiles.map((p: any) => {
      const n = r.visits.filter((v: any) => v.profile === p.key).length
      const f = r.findings.filter((x: any) => x.profile === p.key && !x.alsoAdmin && x.kind !== "api-404").length
      return `- \`${p.key}\` — ${p.label}: ${n} sayfa, ${f} bulgu`
    }),
    "",
    "## Bulgular",
    "",
  ]
  if (r.findings.length === 0) lines.push("Bulgu yok.", "")
  for (const [kind, list] of byKind) {
    lines.push(`### ${kind} (${list.length})`, "")
    const grouped = new Map<string, string[]>()
    for (const f of list) {
      const k = `${f.page} — ${f.detail}${f.alsoAdmin ? " (ADMIN'de de var)" : ""}`
      grouped.set(k, [...(grouped.get(k) ?? []), f.profile])
    }
    for (const [k, who] of grouped) lines.push(`- ${k} · **${[...new Set(who)].join(", ")}**`)
    lines.push("")
  }
  lines.push(`## Açılışta kesilen yazma istekleri (${r.blockedWrites.length})`, "")
  const writes = new Map<string, Set<string>>()
  for (const w of r.blockedWrites) writes.set(`${w.page} → ${w.method} ${w.api}`, (writes.get(`${w.page} → ${w.method} ${w.api}`) ?? new Set()).add(w.profile))
  for (const [k, who] of writes) lines.push(`- ${k} · ${[...who].join(", ")}`)
  lines.push("", `## Sayfa kapısı günlüğü (PAGE_FORBIDDEN, ${r.forbiddenLogs.length})`, "")
  for (const l of r.forbiddenLogs) lines.push(`- ${l.user}: ${String(l.details).split("\n")[0]}`)
  lines.push("", "## Güvenlik: satır sayısı farkı", "")
  lines.push(r.rowDiffs.length === 0 ? "Fark yok — tarama firmaya veri yazmadı." : r.rowDiffs.map((d: any) => `- ${d.table}: ${d.before} → ${d.after}`).join("\n"))
  lines.push("", `Temizlik: ${r.cleaned ? `${r.cleaned.users} kullanıcı, ${r.cleaned.roles} rol, ${r.cleaned.logs} günlük satırı silindi` : "--tut ile BIRAKILDI"}`, "")
  return lines.join("\n")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
