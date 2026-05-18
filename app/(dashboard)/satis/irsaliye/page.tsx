import { Truck } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function SatisIrsaliyePage() {
  return (
    <ComingSoon
      title="Satış İrsaliyesi"
      description="Sevkiyat ve teslimat takibi için satış irsaliyesi oluşturma, e-irsaliyeye dönüştürme ve faturalama akışı yakında geliyor."
      icon={Truck}
      features={[
        "Müşteriye sevkiyat irsaliyesi oluşturma ve PDF/baskı",
        "Mevcut stoktan kalem seçerek depo çıkışı kaydı",
        "Tek tuşla e-İrsaliyeye dönüştürme (GIB)",
        "İrsaliyeden faturaya hızlı geçiş",
      ]}
    />
  )
}
