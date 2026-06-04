import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { listSampleTemplates } from "@/lib/integrations/e-invoice/sample-templates"

export const dynamic = "force-dynamic"

/**
 * Kobipo'ya gömülü örnek şablonları ve uygunluk (içerik yüklü mü) durumlarını
 * döndürür. Önizleme/tanımlama işlemleri templates ve templates/preview
 * route'larında `sampleKey` ile yapılır.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const data = await listSampleTemplates()
    return NextResponse.json({ data })
  } catch (error: any) {
    console.error("templates samples GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
