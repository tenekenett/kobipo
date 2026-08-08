import { NextResponse, type NextRequest } from "next/server"
import { MODULE_GATE_METHOD_HEADER, MODULE_GATE_PATH_HEADER } from "@/lib/module-access"

/**
 * TEK işi: isteğin yolunu ve metodunu route handler'ların okuyabileceği bir header'a
 * yazmak. Next.js route handler'ları `headers()` ile istek header'larını görebilir ama
 * çalıştıkları YOLU göremez; modül kapısı (lib/middleware/company.ts → ensureCompanyAccess)
 * hangi ucun çağrıldığını bilmek zorunda.
 *
 * Alternatifi her API dosyasına elle modül kontrolü eklemekti (200+ dosya, biri atlanınca
 * sessiz açık). Burada tek satır header ile `ensureCompanyAccess` tüm uçları kapatıyor.
 *
 * Dosya adı `proxy.ts`: Next 16'da `middleware.ts` deprecate edildi, dışa aktarılan
 * fonksiyonun adı da `proxy` olmak zorunda. DB/oturum işi YAPMAZ, yalnızca header yazar.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(MODULE_GATE_PATH_HEADER, request.nextUrl.pathname)
  headers.set(MODULE_GATE_METHOD_HEADER, request.method)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Yalnız API. Sayfalar kapıya ModuleGuard ile takılır (istemci) — sunucu tarafında
  // sayfa render'ını kesmek hata sınırına düşürür, kullanıcıya "Bu modül kapalı"
  // ekranı göstermek daha doğru.
  matcher: ["/api/:path*"],
}
