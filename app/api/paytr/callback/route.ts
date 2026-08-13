import { handlePaytrNotification } from "@/lib/integrations/paytr/notification"

export const dynamic = "force-dynamic"

/**
 * PayTR ödeme bildirimi — KANONİK adres (sunucu-sunucu, OTURUMSUZ).
 *
 * PayTR mağaza panelindeki "Bildirim URL" için önerilen adres budur:
 *   https://<alan-adı>/api/paytr/callback
 * Kontör ve paket/abonelik ödemelerinin ikisini de karşılar
 * ([[lib/integrations/paytr/notification.ts]]). Eski adresler
 * (`/api/kontor/paytr/callback`, `/api/billing/paytr/callback`) aynı işi yaptığı için
 * panel ayarı değişmeden de çalışır.
 */
export async function POST(request: Request) {
  return handlePaytrNotification(request)
}
