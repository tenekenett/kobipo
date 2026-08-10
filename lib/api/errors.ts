import { NextResponse } from "next/server"
import { MODULE_LOCKED_CODE, moduleLockedFrom } from "@/lib/module-access"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { PAGE_FORBIDDEN_CODE, pageForbiddenFrom } from "@/lib/page-access"
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
