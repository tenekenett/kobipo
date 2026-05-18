import { ScrollText } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function SatinAlmaTeklifiPage() {
  return (
    <ComingSoon
      title="Satın Alma Teklifi"
      description="Tedarikçilerden alacağınız ürün/hizmetler için teklif isteyin, gelen tekliflere göre seçim yapın."
      icon={ScrollText}
      features={[
        "Birden çok tedarikçiye RFQ (teklif talebi) gönderme",
        "Gelen teklifleri karşılaştırma tablosu",
        "Onaylanan teklifi alış siparişine dönüştürme",
        "Tedarikçi bazında teklif geçmişi",
      ]}
    />
  )
}
