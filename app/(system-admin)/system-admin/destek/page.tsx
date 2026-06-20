import { LifeBuoy } from "lucide-react"
import { SupportAdmin } from "@/components/system-admin/support-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminDestekPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <LifeBuoy className="h-8 w-8 text-orange-400" />
          Destek Talepleri
        </h1>
        <p className="text-slate-400 mt-1">
          Tüm firmaların destek taleplerini görüntüleyin ve yanıtlayın
        </p>
      </div>

      <SupportAdmin />
    </div>
  )
}
