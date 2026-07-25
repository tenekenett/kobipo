import { CupSoda } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

// Yer tutucu — gerçek ekran docs/restoran/PLAN.md "Adım 5"te tarif ediliyor.
// quick-sale-screen.tsx'ten ödeme kutusu + fiş yazdırma ayıklanarak kurulacak.
export default function RestoranSatisPage() {
  return (
    <ComingSoon
      title="Kahveci Satış"
      icon={CupSoda}
      description="Dokunmatik menü ekranı: ürüne bas, ödemeyi al, fişi yazdır. Satış anında reçeteli ürünlerin hammaddesi stoktan otomatik düşer."
      features={[
        "Kategori sekmeli, büyük dokunmatik ürün kartları",
        "Nakit / kart / havale + bölünmüş ödeme",
        "Reçete bileşeni yetersizse uyarı (satış engellenmez)",
        "Kritik hammadde paneli",
        "Termal fiş yazdırma",
      ]}
    />
  )
}
