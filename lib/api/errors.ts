import { NextResponse } from "next/server"
import { MODULE_LOCKED_CODE, moduleLockedFrom } from "@/lib/module-access"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { PAGE_FORBIDDEN_CODE, pageForbiddenFrom } from "@/lib/page-access"
import {
  ACCOUNT_ARCHIVED_CODE,
  ACCOUNT_ARCHIVED_MESSAGE_TR,
  accountArchivedFrom,
} from "@/lib/billing/archive"
import { navPage } from "@/lib/nav/pages"

/**
 * `ensureCompanyAccess` / `ensureCompanyWrite` "Access denied..." fırlatır; route'lar bunu
 * yakalayıp 403'e çevirir. Tek fark: hata MODÜL KAPISINDAN geldiyse gövdeye makine-okunur
 * `code: "MODULE_LOCKED"` ve gereken modül anahtarları eklenir — arayüz böylece "yetkiniz
 * yok" yerine "bu modülü satın alın" diyebilir (bkz. components/dashboard/module-guard.tsx).
 *
 * Rol/firma kaynaklı diğer "Access denied" hataları için davranış aynen korunur: çağıran
 * ne mesaj gösteriyorsa (`"Access denied"` sabiti ya da `error.message`) o basılır.
 */
export function accessDeniedResponse(error: unknown, fallbackMessage: unknown = "Access denied") {
  const locked = moduleLockedFrom(error)
  if (locked) {
    return NextResponse.json(
      {
        error: moduleLockedMessage(locked.modules),
        code: MODULE_LOCKED_CODE,
        /** Bu uç için yeterli modüllerden HERHANGİ BİRİ açılırsa istek geçer. */
        modules: locked.modules,
      },
      { status: 403 }
    )
  }

  // Arşiv kapısı: hesap salt-okunur. "Yetkiniz yok" DEĞİL — yetkisi var, hesabı
  // kapalı; arayüz bu koda bakıp "verilerinizi indirin / abonelik başlatın" der.
  if (accountArchivedFrom(error)) {
    return NextResponse.json(
      { error: ACCOUNT_ARCHIVED_MESSAGE_TR, code: ACCOUNT_ARCHIVED_CODE },
      { status: 403 },
    )
  }

  // Sayfa kapısı: modül AÇIK ama bu kullanıcının izin listesinde o ekran yok. Mesaj
  // "satın alın" değil "yöneticinize başvurun" olmalı — izin firma yöneticisinin işi.
  const forbidden = pageForbiddenFrom(error)
  if (forbidden) {
    return NextResponse.json(
      {
        error: pageForbiddenMessage(forbidden.pages),
        code: PAGE_FORBIDDEN_CODE,
        /** Bu uç için yeterli sayfalardan HERHANGİ BİRİ izinliyse istek geçer. */
        pages: forbidden.pages,
      },
      { status: 403 }
    )
  }

  return NextResponse.json(
    { error: typeof fallbackMessage === "string" ? fallbackMessage : "Access denied" },
    { status: 403 }
  )
}

/**
 * Erişim hatası mı? (`ensureCompanyAccess`/`ensureCompanyWrite` ve iki kapı hep
 * "Access denied…" ile başlayan bir mesaj fırlatır.)
 */
export function isAccessDeniedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Access denied")
}

/**
 * Next'in AKIŞ KONTROLÜ hataları — `redirect()` / `notFound()` bunları fırlatarak
 * çalışır ve yakalanırlarsa yönlendirme sessizce ölür. Sarmalayıcı bu ikisini
 * olduğu gibi yeniden fırlatmalı.
 */
function isControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
}

/**
 * Route handler sarmalayıcısı: erişim reddini 403'e, oturumsuzluğu 401'e çevirir.
 *
 * NEDEN VAR: kapılar (`ensureCompanyAccess` → modül + sayfa) hata FIRLATIR; bunu 403'e
 * çevirmek route'un işiydi ve 194 kapılı ucun 57'sinde bu adım atlanmıştı — çoğunda
 * hiç `catch` yoktu. Sonuç: yetkisiz istek boş gövdeli **500** alıyordu. Erişim yine
 * engelleniyordu (veri sızmıyor) ama kullanıcı sebebini göremiyor, arayüz de
 * "yetkiniz yok" ekranını çizemiyordu. `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED`
 * açılana kadar bu yolu yalnız kısıtlı çalışanlar görebiliyordu; artık her rol görebilir.
 *
 * Kendi `catch`i olan route'lar bunu KULLANMAZ — orada erişim dalı catch'in içine
 * yazılır (yoksa iç catch hatayı önce yakalar ve sarmalayıcıya hiç ulaşmaz).
 */
export function withApiErrors<A extends unknown[], R extends Response>(
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      if (isControlFlowError(error)) throw error
      if (error instanceof Error && error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      if (isAccessDeniedError(error)) return accessDeniedResponse(error)
      console.error("API error:", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }
}

const MODULE_LABELS = new Map(MANAGEABLE_MODULES.map((m) => [m.key, m.label]))

function pageForbiddenMessage(pages: string[]): string {
  const labels = pages.map((href) => navPage(href)?.label ?? href)
  if (labels.length === 0) return "Bu işlem için yetkiniz yok."
  if (labels.length === 1) return `"${labels[0]}" sayfası için yetkiniz yok.`
  return `Bu işlem şu sayfalardan birinin yetkisini gerektirir: ${labels.join(", ")}.`
}

function moduleLockedMessage(modules: string[]): string {
  const labels = modules.map((key) => MODULE_LABELS.get(key) ?? key)
  if (labels.length === 0) return "Bu işlem hesabınızda kapalı bir modüle ait."
  if (labels.length === 1) return `${labels[0]} modülü hesabınızda kapalı.`
  return `Bu işlem şu modüllerden birini gerektirir, hesabınızda hepsi kapalı: ${labels.join(", ")}.`
}
