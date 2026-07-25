import { ClipboardList } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — bkz. docs/restoran/PLAN.md "Adım 6".
// Mevcut CashCount (kasa sayımı) modeline bağlanacak.
export default function RestoranGunSonuPage() {
  return (
    <ComingSoon
      title="Gün Sonu"
      icon={ClipboardList}
      description="Günün fişleri, ödeme tipine göre dağılım ve kasa sayımıyla karşılaştırma."
      features={[
        "Günün fiş listesi ve toplamı",
        "Nakit / kart / havale dağılımı",
        "Kasa sayımı (CashCount) ile fark kontrolü",
      ]}
    />
  )
}
