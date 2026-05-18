import { ClipboardList } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function AlisSiparisPage() {
  return (
    <ComingSoon
      title="Alış Siparişi"
      description="Tedarikçilere gönderdiğiniz alış siparişlerini takip edin ve teslim aldıkça irsaliye/faturaya dönüştürün."
      icon={ClipboardList}
      features={[
        "Çoklu kalemli sipariş oluşturma ve PDF paylaşımı",
        "Beklenen teslim tarihi ve tedarikçi performans takibi",
        "Kısmi/tam teslim alma kayıtları",
        "Açık alış siparişlerinin yaşlandırması",
      ]}
    />
  )
}
