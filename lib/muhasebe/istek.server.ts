import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { BadRequestError } from "@/lib/http/query-params"
import { withApiErrors } from "@/lib/api/errors"
import { defterBaglami, fisUretilirMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

/**
 * Muhasebe uçlarının ortak girişi: oturum → firma → kapı (okuma/yazma) → defter.
 *
 * Kapı `ensureCompanyAccess`: modül (`accounting`) ve sayfa/rol kuralı orada
 * (lib/module-access.ts, lib/page-access.ts). Şubede modül hiç açılmadığı için şube
 * seçiliyken bu uçlar MODULE_LOCKED döner; defter ana firma seçilerek açılır.
 */
export async function muhasebeGirisi(
  companyIdHam: string | null | undefined,
  opts: { yazma?: boolean } = {},
): Promise<{ kullaniciId: string; companyId: string; ctx: DefterBaglami }> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized")
  const companyId = await resolveCompanyId(companyIdHam ?? null)
  if (!companyId) throw new BadRequestError("companyId zorunlu")
  if (opts.yazma) await ensureCompanyWrite(companyId)
  else await ensureCompanyAccess(companyId)
  const ctx = await defterBaglami(companyId)
  if (!ctx) throw new FisHatasi("Firma bulunamadı", 404)
  return { kullaniciId: user.id, companyId, ctx }
}

/** Kurulum yapılmış defter ister; yapılmadıysa 409 + `code: "KURULUM_YOK"`. */
export function kuruluDefter(ctx: DefterBaglami): DefterBaglami & { ayar: MuhasebeAyari } {
  if (!fisUretilirMi(ctx)) throw new KurulumYokHatasi()
  return ctx
}

export class KurulumYokHatasi extends FisHatasi {
  constructor() {
    super("Muhasebe kurulumu yapılmadı. Muhasebe Ayarları'ndan başlangıç tarihini seçip kurun.", 409)
  }
}

/** FisHatasi → JSON yanıt; değilse null (withApiErrors devralır). */
export function muhasebeHataYaniti(e: unknown): NextResponse | null {
  if (e instanceof KurulumYokHatasi) {
    return NextResponse.json({ error: e.message, code: "KURULUM_YOK" }, { status: e.status })
  }
  if (e instanceof FisHatasi) return NextResponse.json({ error: e.message }, { status: e.status })
  return null
}

/** Gövdeyi JSON olarak okur; bozuksa 400. */
export async function jsonGovde(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") throw new BadRequestError("Geçersiz istek gövdesi")
  return body as Record<string, unknown>
}

/** "YYYY-MM-DD" → 00:00 UTC; boş → null; bozuk → 400. */
export function gunParam(v: unknown, ad: string): Date | null {
  if (v == null || v === "") return null
  const s = String(v).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestError(`${ad} YYYY-AA-GG biçiminde olmalı`)
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new BadRequestError(`${ad} geçerli bir tarih değil`)
  return d
}

/** `withApiErrors` + muhasebe hatalarının (FisHatasi, kurulum yok) eşlenmesi. */
export function muhasebeUcu<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return withApiErrors(async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (e) {
      const yanit = muhasebeHataYaniti(e)
      if (yanit) return yanit
      throw e
    }
  })
}
