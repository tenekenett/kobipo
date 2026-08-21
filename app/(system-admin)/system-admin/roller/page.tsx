import { ShieldCheck } from "lucide-react"
import { RoleTemplateAdmin } from "@/components/system-admin/role-template-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminRollerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-indigo-400" />
          Hazır Roller
        </h1>
        <p className="text-slate-400 mt-1">
          Kobipo&apos;nun tüm firmalara sunduğu rol kalıpları (Kasiyer, Garson, Depo Sorumlusu…).
          Firma, Ayarlar → Rol Yetkileri ekranında bunları kart olarak görür ve seçtiğinde
          kalıp kendi rolüne kopyalanır.
        </p>
      </div>

      <RoleTemplateAdmin />
    </div>
  )
}
