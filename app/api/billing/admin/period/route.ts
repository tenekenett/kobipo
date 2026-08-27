import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { BillingAdminError, grantAccountPeriod } from "@/lib/billing/admin"
import type { GrantMode } from "@/lib/billing/period"

export const dynamic = "force-dynamic"

/**
 * Bir hesaba ELLE abonelik süresi verir/uzatır. Süper-admin korumalı.
 *
 * Body: {
 *   companyId, mode: "extend" | "set",
 *   days? | months? | untilDate?,          // TAM OLARAK biri
 *   billingCycle?, modules?, autoRenew?,
 *   paymentReceived?, amount?,             // havale/elden tahsilat → sipariş + fatura
 * }
 *
 * Serbest metinli `reason` YOK (2026-08-27'de kaldırıldı): olay özeti müşterinin kendi
 * "Abonelik geçmişi" ekranında görünüyor, iç not için tasarlanmış kutu müşteriye açılıyordu.
 * İz `actorUserId` + yapısal `detail` ile tutuluyor.
 *
 * İş kuralının tamamı [[lib/billing/admin.ts]] → `grantAccountPeriod`'da; bu uç yalnız
 * gövdeyi normalize eder. Kuralı uca kopyalamak, süreyi bilmeyen ikinci bir kapı açardı.
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  const mode: GrantMode = body?.mode === "set" ? "set" : "extend"

  if (!companyId) {
    return NextResponse.json({ error: "companyId gerekli" }, { status: 400 })
  }

  // null/undefined = "verilmedi". Sayıya çevirme burada yapılır ki iş kuralı yalnız
  // sayı ya da null görsün; geçersiz metin `NaN` olarak gidip doğrulamaya takılır.
  const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v))

  try {
    const result = await grantAccountPeriod({
      companyId,
      mode,
      days: num(body?.days),
      months: num(body?.months),
      untilDate: typeof body?.untilDate === "string" && body.untilDate ? body.untilDate : null,
      billingCycle: typeof body?.billingCycle === "string" ? body.billingCycle : null,
      // Boş dizi ANLAMLI: "tüm modülleri kapat". Bu yüzden `null` ile ayrılır.
      modules: Array.isArray(body?.modules)
        ? (body.modules as unknown[]).filter((m): m is string => typeof m === "string")
        : null,
      autoRenew: typeof body?.autoRenew === "boolean" ? body.autoRenew : null,
      paymentReceived: body?.paymentReceived === true,
      amount: num(body?.amount),
      actorUserId: auth.user?.id ?? null,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof BillingAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("billing admin period error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Süre verilemedi" },
      { status: 500 },
    )
  }
}
