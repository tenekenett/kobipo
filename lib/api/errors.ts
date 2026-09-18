import { NextResponse } from "next/server"
import { MODULE_LOCKED_CODE, moduleLockedFrom } from "@/lib/module-access"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { PAGE_FORBIDDEN_CODE, pageForbiddenFrom } from "@/lib/page-access"
import {
  ACCOUNT_ARCHIVED_CODE,
  ACCOUNT_ARCHIVED_MESSAGE_TR,
  accountArchivedFrom,
} from "@/lib/billing/archive"
import {
  CARI_FORBIDDEN_CODE,
  CARI_FORBIDDEN_MESSAGE_TR,
  cariForbiddenFrom,
} from "@/lib/cari/visibility"
import { navPage } from "@/lib/nav/pages"
import { FOREIGN_RECORD_CODE, foreignRecordFrom } from "@/lib/company/owned"
import { MysoftUrlError } from "@/lib/integrations/e-invoice/constants"
import { badRequestFrom } from "@/lib/http/query-params"
import { Prisma } from "@prisma/client"

/**
 * `ensureCompanyAccess` / `ensureCompanyWrite` "Access denied..." fırlatır; route'lar bunu
 * yakalayıp 403'e çevirir. Tek fark: hata MODÜL KAPISINDAN geldiyse gövdeye makine-okunur
 * `code: "MODULE_LOCKED"` ve gereken modül anahtarları eklenir — arayüz böylece "yetkiniz
 * yok" yerine "bu modülü satın alın" diyebilir (bkz. components/dashboard/module-guard.tsx).
 *
 * Rol/firma kaynaklı diğer "Access denied" hataları için davranış aynen korunur: çağıran
 * ne mesaj gösteriyorsa (`"Access denied"` sabiti ya da `error.message`) o basılır.
 */
/**
 * İç catch'i olan uçlar için kısa yol: hata geçersiz parametre (BadRequestError) ise
 * 400 döner, değilse null (çağıran kendi 500'üne devam eder). `withApiErrors` zaten
 * aynısını yapıyor ama kendi try/catch'i olan route withApiErrors'a ulaşmadan yakalar.
 */
export function badRequestResponse(error: unknown): NextResponse | null {
  const bad = badRequestFrom(error)
  return bad ? NextResponse.json({ error: bad.message, code: bad.code }, { status: 400 }) : null
}

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

  // Cari görünürlük kapısı: yetki de modül de yerinde, cari BU KULLANICIYA
  // atanmamış. Ayrı bir mesaj gerekiyor — "yetkiniz yok" kullanıcıyı yöneticiye
  // yollar, oysa çözüm cari kartındaki atamadır (bkz. lib/cari/visibility.ts).
  if (cariForbiddenFrom(error)) {
    return NextResponse.json(
      { error: CARI_FORBIDDEN_MESSAGE_TR, code: CARI_FORBIDDEN_CODE },
      { status: 403 },
    )
  }

  // Sahiplik kapısı: gövdedeki ürün/cari/depo id'si BAŞKA firmanın. Kullanıcıya
  // "yetkiniz yok" değil "bu firmaya ait değil, yeniden seçin" denir; id basılmaz
  // (bkz. lib/company/owned.ts).
  const foreign = foreignRecordFrom(error)
  if (foreign) {
    return NextResponse.json(
      { error: foreign.messageTr, code: FOREIGN_RECORD_CODE, model: foreign.model },
      { status: 403 },
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
      // Firma kaydındaki Mysoft adresi bilinen ortamlardan değil: yapılandırma hatası,
      // 500 değil — kullanıcı Ayarlar › e-Dönüşüm'de ortamı yeniden seçmeli.
      if (error instanceof MysoftUrlError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      // Geçersiz query parametresi (tarih/sayı) → 400, açıklayıcı mesajla.
      const bad = badRequestFrom(error)
      if (bad) return NextResponse.json({ error: bad.message, code: bad.code }, { status: 400 })
      // GÜVENLİK AĞI: geçersiz girdi ORM'e ulaşıp patladıysa (ör. `new Date("abc")` →
      // Prisma validation) ham sorgu metni gövdeye SIZDIRILMAZ; 400 generic döner.
      // Kök çözüm parametre doğrulamasıdır (lib/http/query-params.ts), bu son duvar.
      if (
        error instanceof Prisma.PrismaClientValidationError ||
        (error instanceof RangeError && /invalid (time value|date)/i.test(error.message))
      ) {
        return NextResponse.json({ error: "Geçersiz istek parametresi." }, { status: 400 })
      }
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
