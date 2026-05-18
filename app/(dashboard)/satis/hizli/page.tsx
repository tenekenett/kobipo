import { Zap } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function HizliSatisPage() {
  return (
    <ComingSoon
      title="Hızlı Satış"
      description="POS benzeri hızlı satış ekranı — barkod okutarak veya ürün arayarak saniyeler içinde satış kapatın."
      icon={Zap}
      features={[
        "Barkod okuyucu desteği ile hızlı kalem ekleme",
        "Tek ekranda nakit/kart/havale ödeme kaydı",
        "Otomatik fiş ve isteğe bağlı e-fatura",
        "Vardiya/kasa raporu",
      ]}
    />
  )
}
