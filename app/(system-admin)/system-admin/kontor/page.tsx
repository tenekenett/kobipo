import { Coins } from "lucide-react"
import { KontorAdmin } from "@/components/system-admin/kontor-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminKontorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Coins className="h-8 w-8 text-orange-400" />
          Kontör Yönetimi
        </h1>
        <p className="text-slate-400 mt-1">
          Bayi tarifeleri, satılabilir paketler ve müşteri kontör siparişleri
        </p>
      </div>

      <KontorAdmin />
    </div>
  )
}
