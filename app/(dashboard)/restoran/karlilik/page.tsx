import { TrendingUp } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — bkz. docs/restoran/PLAN.md "Adım 6".
// Maliyet, satış anında StockMovement.unitPrice'a donduruluyor; bu rapor
// reçete hareketlerinin Σ |quantity| × unitPrice'ını okuyacak.
export default function RestoranKarlilikPage() {
  return (
    <ComingSoon
      title="Karlılık"
      icon={TrendingUp}
      description="Seçilen tarih aralığında ciro, hammadde maliyeti ve brüt kâr. Maliyet satış anında dondurulduğu için sonradan gelen zamlar geçmiş günleri değiştirmez."
      features={[
        "Ciro, fiş adedi, ortalama fiş",
        "Hammadde maliyeti (reçete hareketlerinden)",
        "Brüt kâr ve kâr marjı %",
      ]}
    />
  )
}
