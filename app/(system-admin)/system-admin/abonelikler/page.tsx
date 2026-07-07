import { CreditCard } from "lucide-react"
import { SubscriptionAdmin } from "@/components/system-admin/subscription-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminAboneliklerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-indigo-400" />
          Abonelik & Sipariş Yönetimi
        </h1>
        <p className="text-slate-400 mt-1">
          Firmaların abonelik/sipariş durumunu izle; test için kullanımı sıfırla (taze deneme / kilitli)
          ve yarıda kalmış siparişleri iptal et
        </p>
      </div>

      <SubscriptionAdmin />
    </div>
  )
}
