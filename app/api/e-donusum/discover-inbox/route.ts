import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Mysoft InvoiceInbox endpoint keşfi.
 *
 * Adımlar:
 *  1) OAuth token al
 *  2) Mysoft swagger JSON'ını dene (çeşitli yollar) — başarılıysa Inbox/Incoming
 *     içeren tüm path'leri listele. Bu, en kesin bilgi kaynağı.
 *  3) Bilinen endpoint ailelerinin geniş bir liste varyantını dene; ilk
 *     2xx + succeed=true yanıtı raporla.
 *
 * Hiçbir mevcut akışı etkilemez:
 *  - DB'de yazma yok
 *  - Mysoft'ta yalnızca GET çağrıları
 *  - Sadece dönen JSON şemasını / path listesini rapor eder
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId, startDate: rawStart, endDate: rawEnd } = body || {}
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        eDonusumTenantVkn: true,
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Önce E-Dönüşüm Ayarları'na API kullanıcı adı/şifresini yazıp kaydedin." },
        { status: 400 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { error: "Kayıtlı şifre çözülemedi. Şifreyi tekrar girip kaydedin." },
        { status: 400 },
      )
    }

    const baseUrl = company.eDonusumApiUrl || "https://edocumentapi.mytest.tr"

    // 1) Token
    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: company.eDonusumApiUsername,
        password: passwordText,
        grant_type: "password",
      }),
    })
    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenData?.access_token) {
      return NextResponse.json(
        { error: "Mysoft token alınamadı.", rawTokenResponse: tokenData },
        { status: 400 },
      )
    }
    const token: string = tokenData.access_token
    const authHeader = { Authorization: `Bearer ${token}` }

    // 2) Swagger / OpenAPI keşfi — auth'lı çağırıyoruz, bazı sürümlerde anon erişim kapalı
    const swaggerPaths = [
      "/swagger/v1/swagger.json",
      "/swagger/v2/swagger.json",
      "/swagger/v8/swagger.json",
      "/swagger.json",
      "/api/swagger.json",
      "/v1/api-docs",
      "/swagger/docs/v1",
    ]
    let swaggerHit: {
      path: string
      status: number
      pathCount: number
      inboxPaths: Array<{ path: string; methods: string[] }>
      allPaths?: string[]
    } | null = null
    const swaggerAttempts: Array<{ path: string; status: number; note?: string }> = []
    for (const p of swaggerPaths) {
      try {
        const res = await fetch(`${baseUrl}${p}`, { method: "GET", headers: authHeader })
        const ct = res.headers.get("content-type") || ""
        let parsed: any = null
        if (ct.includes("application/json")) {
          parsed = await res.json().catch(() => null)
        }
        swaggerAttempts.push({
          path: p,
          status: res.status,
          note: !ct.includes("json") ? `non-json (${ct.slice(0, 40)})` : undefined,
        })
        if (res.ok && parsed?.paths && typeof parsed.paths === "object") {
          const allPaths = Object.keys(parsed.paths)
          const inboxPaths = allPaths
            .filter((pp) =>
              /inbox|incoming|received|gelen|alici|alis|alış/i.test(pp),
            )
            .map((pp) => ({
              path: pp,
              methods: Object.keys(parsed.paths[pp] || {}).map((m) => m.toUpperCase()),
            }))
          swaggerHit = {
            path: p,
            status: res.status,
            pathCount: allPaths.length,
            inboxPaths,
            // İlk 80 path'i geri döndür — debug için, çok büyük olmasın
            allPaths: allPaths.slice(0, 80),
          }
          break
        }
      } catch (e: any) {
        swaggerAttempts.push({ path: p, status: 0, note: e?.message || "fetch error" })
      }
    }

    // 3) Aralık (default 30 gün) — varsa swagger sonucundan akıllı seçeceğiz,
    //    yoksa generic deneme listesinde kullanılacak.
    const endDate = rawEnd ? new Date(rawEnd) : new Date()
    const startDate = rawStart
      ? new Date(rawStart)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    const startIso = startDate.toISOString()
    const endIso = endDate.toISOString()

    // 4) Sürpriz olabilecek path/controller isimlerini geniş tut.
    //    Mysoft Outbox tarafı: /api/InvoiceOutbox/* ve /api/Tenant/*
    //    Inbox/Incoming için bilinen alternatif controller adları:
    type Attempt = {
      label: string
      method: "GET" | "POST"
      path: string
      query?: Record<string, string>
      body?: any
    }

    const inboxControllerCandidates = [
      "InvoiceInbox",
      "Inbox",
      "EInvoiceInbox",
      "IncomingInvoice",
      "InboxInvoice",
      "InvoiceIncoming",
      "EArchiveInbox",
      "EFaturaInbox",
      "EArsiv",
    ]
    const inboxActionCandidates = [
      "getInvoiceInbox",
      "getInbox",
      "getInboxList",
      "getInvoiceInboxList",
      "getIncomingInvoice",
      "getIncomingInvoiceList",
      "list",
      "getList",
      "getAll",
    ]
    const attempts: Attempt[] = []
    for (const ctrl of inboxControllerCandidates) {
      for (const action of inboxActionCandidates) {
        attempts.push({
          label: `GET /api/${ctrl}/${action} (date range)`,
          method: "GET",
          path: `/api/${ctrl}/${action}`,
          query: { startDate: startIso, endDate: endIso, limit: "20" },
        })
      }
    }

    type ResultRow = {
      label: string
      method: string
      url: string
      status: number
      ok: boolean
      succeed?: boolean
      itemCount?: number
      sampleKeys?: string[]
      message?: string
      bodySnippet?: string
      raw?: any
    }
    const results: ResultRow[] = []
    let firstSuccess: number | null = null

    // Eğer swagger içinden Inbox path'leri bulduysak SADECE onları dene (daha az gürültü).
    let effectiveAttempts: Attempt[] = attempts
    if (swaggerHit && swaggerHit.inboxPaths.length > 0) {
      effectiveAttempts = []
      for (const ip of swaggerHit.inboxPaths) {
        const isGet = ip.methods.includes("GET")
        const isPost = ip.methods.includes("POST")
        if (isGet) {
          effectiveAttempts.push({
            label: `GET ${ip.path}`,
            method: "GET",
            path: ip.path,
            query: { startDate: startIso, endDate: endIso, limit: "20" },
          })
        }
        if (isPost) {
          effectiveAttempts.push({
            label: `POST ${ip.path}`,
            method: "POST",
            path: ip.path,
            body: { startDate: startIso, endDate: endIso, limit: 20 },
          })
        }
      }
    }

    // Erken bulma: ilk başarılıyla dur — gürültüyü en aza indir
    for (let i = 0; i < effectiveAttempts.length; i++) {
      const a = effectiveAttempts[i]
      const url = new URL(`${baseUrl}${a.path}`)
      if (a.query) {
        for (const [k, v] of Object.entries(a.query)) url.searchParams.set(k, v)
      }
      try {
        const res = await fetch(url.toString(), {
          method: a.method,
          headers: {
            ...authHeader,
            "Content-Type": "application/json",
          },
          body: a.method === "POST" ? JSON.stringify(a.body ?? {}) : undefined,
        })

        const ct = res.headers.get("content-type") || ""
        let parsed: any = null
        let bodySnippet: string | undefined
        if (ct.includes("application/json")) {
          parsed = await res.json().catch(() => null)
        } else {
          const text = await res.text().catch(() => "")
          bodySnippet = text.slice(0, 200)
        }

        const items: any[] | undefined = Array.isArray(parsed?.data)
          ? parsed.data
          : Array.isArray(parsed?.data?.items)
          ? parsed.data.items
          : Array.isArray(parsed?.items)
          ? parsed.items
          : undefined

        const sampleKeys: string[] | undefined =
          items && items.length > 0 && typeof items[0] === "object" && items[0] !== null
            ? Object.keys(items[0])
            : parsed && typeof parsed === "object"
            ? Object.keys(parsed)
            : undefined

        const ok = res.ok && parsed?.succeed !== false
        if (ok && firstSuccess === null) firstSuccess = i

        // 404'leri özetlemek için kısa kayıt — sadece 200/4xx interesting olanları dene tutmaya değer
        if (res.status === 404) {
          // 404'leri kayda al ama bodySnippet'i tutma (HTML 404 sayfası)
          results.push({
            label: a.label,
            method: a.method,
            url: url.toString().replace(baseUrl, ""),
            status: 404,
            ok: false,
          })
        } else {
          results.push({
            label: a.label,
            method: a.method,
            url: url.toString().replace(baseUrl, ""),
            status: res.status,
            ok: res.ok,
            succeed: typeof parsed?.succeed === "boolean" ? parsed.succeed : undefined,
            itemCount: items?.length,
            sampleKeys,
            message: parsed?.message || undefined,
            bodySnippet,
            raw: ok ? parsed : undefined,
          })
        }

        if (ok) break
      } catch (error: any) {
        results.push({
          label: a.label,
          method: a.method,
          url: a.path,
          status: 0,
          ok: false,
          message: error?.message || "Network/parse error",
        })
      }
    }

    // 404'ler çok çıktıysa raporda gürültü yapmasın — sadece "non-404" ya da başarılı olanları gönder.
    const interesting = results.filter((r) => r.status !== 404 || r.ok)
    const non404Count = interesting.length
    const total404 = results.length - non404Count

    return NextResponse.json({
      baseUrl,
      tenantVkn: company.eDonusumTenantVkn || null,
      dateRange: { startDate: startIso, endDate: endIso },
      swagger: {
        attempts: swaggerAttempts,
        hit: swaggerHit,
      },
      attemptStats: {
        triedCount: effectiveAttempts.length,
        notFoundCount: total404,
        interestingCount: non404Count,
        usedSwaggerPaths: !!swaggerHit && swaggerHit.inboxPaths.length > 0,
      },
      firstSuccess: firstSuccess !== null ? interesting.findIndex((r) => r.ok) : null,
      summary: interesting.map((r) => ({
        label: r.label,
        method: r.method,
        url: r.url,
        status: r.status,
        ok: r.ok,
        succeed: r.succeed,
        itemCount: r.itemCount,
        sampleKeys: r.sampleKeys,
        message: r.message,
        bodySnippet: r.bodySnippet,
      })),
      successRaw: interesting.find((r) => r.ok)?.raw ?? null,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("discover-inbox error:", error)
    return NextResponse.json(
      { error: message || "Keşif sırasında hata." },
      { status: 500 },
    )
  }
}
