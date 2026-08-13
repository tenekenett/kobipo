import { handlePaytrNotification } from "@/lib/integrations/paytr/notification"

export const dynamic = "force-dynamic"

/**
 * PayTR ödeme bildirimi (sunucu-sunucu, OTURUMSUZ) — kontör adresi.
 *
 * Mantık ortak yönlendiricidedir ([[lib/integrations/paytr/notification.ts]]): PayTR'ın
 * bildirim URL'si mağaza başına TEK olduğu için bu uca paket/abonelik ödemesi de düşebilir
 * (canlıda öyle oluyordu) ve doğru akışa yönlendirilir. Bu yüzden PayTR panelindeki adres
 * DEĞİŞMEDEN iki akış da çalışır. Kanonik adres: `/api/paytr/callback`.
 */
export async function POST(request: Request) {
  return handlePaytrNotification(request)
}
