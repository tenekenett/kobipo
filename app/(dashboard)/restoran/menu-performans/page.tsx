import { BarChart3 } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — bkz. docs/restoran/PLAN.md "Adım 6".
export default function RestoranMenuPerformansPage() {
  return (
    <ComingSoon
      title="Menü Performansı"
      icon={BarChart3}
      description="Ürün bazında satış adedi, ciro, maliyet ve kâr. En çok satan ile en çok kazandıran ayrımını görünür kılar."
      features={[
        "Ürün bazında satış adedi ve ciro",
        "Reçeteden hesaplanan maliyet ve kâr",
        "Kâr marjına göre sıralama",
      ]}
    />
  )
}
