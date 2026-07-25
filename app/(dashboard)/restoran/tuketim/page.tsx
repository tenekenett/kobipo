import { Package } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — bkz. docs/restoran/PLAN.md "Adım 6".
// Kaynak: description'ı "Reçete:" ile başlayan stok hareketleri.
export default function RestoranTuketimPage() {
  return (
    <ComingSoon
      title="Hammadde Tüketimi"
      icon={Package}
      description="Seçilen aralıkta hangi hammaddeden ne kadar gittiği. Satın alma planlaması için kullanılır."
      features={[
        "Hammadde bazında tüketim miktarı ve tutarı",
        "Reçeteden türeyen hareketler doğrudan satıştan ayrı",
        "Kritik seviyenin altına düşenler işaretli",
      ]}
    />
  )
}
