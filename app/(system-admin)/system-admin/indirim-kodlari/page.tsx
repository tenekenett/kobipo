import { Percent } from "lucide-react"
import { DiscountCodeAdmin } from "@/components/system-admin/discount-code-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminDiscountCodesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Percent className="h-8 w-8 text-orange-400" />
          İndirim Kodları
        </h1>
        <p className="text-slate-400 mt-1">
          Kontör ve abonelik satın alımlarında kullanılacak kuponlar
        </p>
      </div>

      <DiscountCodeAdmin />
    </div>
  )
}
