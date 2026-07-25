import { ChefHat } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — bkz. docs/restoran/PLAN.md "Adım 3/6".
// API hazır: GET/POST /api/restoran/recipes, GET/DELETE /api/restoran/recipes/[id]
//
// NOT: Bu sayfa Stok grubunda yaşar ama Restoran & Kafe modülüne bağlıdır
// (nav-config.tsx → NavItemDef.module + PATH_MODULE_OVERRIDES).
export default function ReceptelerPage() {
  return (
    <ComingSoon
      title="Reçeteler"
      icon={ChefHat}
      description="Bir ürünün hangi hammaddelerden oluştuğunu tanımlayın. Satışta mamül yerine bileşenleri stoktan düşer; yarı mamüller (ör. espresso shot) hammaddeye kadar açılır."
      features={[
        "Bileşen, miktar ve birim (kg alıp gram kullanma)",
        "Fire yüzdesi",
        "Çok seviyeli reçete — yarı mamül desteği",
        "Canlı maliyet ve kâr marjı özeti",
      ]}
      backHref="/stok/urunler"
    />
  )
}
