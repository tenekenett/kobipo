import { ClipboardList } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function SatisSiparisPage() {
  return (
    <ComingSoon
      title="Satış Siparişi"
      description="Müşteriden gelen siparişleri kaydedin, stoktan rezerve edin ve irsaliye/faturaya dönüştürün."
      icon={ClipboardList}
      features={[
        "Sipariş kalemlerini ürün/hizmet kataloğundan ekleme",
        "Stok rezervasyonu ve teslimat durumu takibi",
        "Sipariş → İrsaliye → Fatura dönüşüm akışı",
        "Açık/kapanmış sipariş raporları",
      ]}
    />
  )
}
