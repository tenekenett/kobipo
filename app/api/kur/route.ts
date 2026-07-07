import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { getTcmbRates } from "@/lib/exchange/tcmb"

export const dynamic = "force-dynamic"

/**
 * Güncel TCMB döviz kurları (USD/EUR → TRY, satış).
 * Ürün fiyatını belge para birimine çevirmek için satış/teklif ekranları kullanır.
 * Hata durumunda 200 + success:false döner ki UI zarifçe elle kur girişine düşebilsin.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    const rates = await getTcmbRates()
    return NextResponse.json({ success: true, ...rates })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Kur bilgisi alınamadı." },
      { status: 200 },
    )
  }
}
