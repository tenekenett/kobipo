import { Package } from "lucide-react"
import { PackageAdmin } from "@/components/system-admin/package-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminPaketlerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Package className="h-8 w-8 text-indigo-400" />
          Paket & Fiyat Yönetimi
        </h1>
        <p className="text-slate-400 mt-1">
          Hazır paketler, tekil modül ve ek şube fiyatları (müşteri abonelik ekranını besler)
        </p>
      </div>

      <PackageAdmin />
    </div>
  )
}
