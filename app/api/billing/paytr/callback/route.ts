import { handlePaytrNotification } from "@/lib/integrations/paytr/notification"

export const dynamic = "force-dynamic"

/**
 * PayTR ödeme bildirimi (sunucu-sunucu, OTURUMSUZ) — paket/abonelik adresi.
 *
 * Mantık ortak yönlendiricidedir ([[lib/integrations/paytr/notification.ts]]): PayTR'ın
 * bildirim URL'si mağaza başına TEK olduğu için bu uca kontör ödemesi de düşebilir ve
 * doğru akışa yönlendirilir. Panelde tek adres yeter — kanonik: `/api/paytr/callback`.
 */
export async function POST(request: Request) {
  return handlePaytrNotification(request)
}
