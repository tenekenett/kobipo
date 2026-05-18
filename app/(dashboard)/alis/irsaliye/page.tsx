import { Truck } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function AlisIrsaliyePage() {
  return (
    <ComingSoon
      title="Alış İrsaliyesi"
      description="Tedarikçiden gelen sevkiyatlar için irsaliye kaydı oluşturun ve stoğa girişini sağlayın."
      icon={Truck}
      features={[
        "Tedarikçi seçimi ve sevkiyat kalemleri kaydı",
        "İrsaliyeden depo girişine otomatik akış",
        "Alış irsaliyesini alış faturasına bağlama",
        "Gelen e-İrsaliyeleri içe alma",
      ]}
    />
  )
}
