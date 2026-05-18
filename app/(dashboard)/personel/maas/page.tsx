import { DollarSign } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function MaasOdemelerPage() {
  return (
    <ComingSoon
      title="Maaş-Ödemeler"
      description="Bordro hesaplamaları, ek ödemeler, kesintiler ve banka ödeme dosyaları."
      icon={DollarSign}
      features={[
        "Aylık bordro hesaplama (SGK, gelir vergisi, damga)",
        "Avans, mesai, prim ve kesinti kalemleri",
        "Banka maaş dosyası (Garanti, İş Bankası, Yapı Kredi vb.)",
        "Bordro PDF ve e-posta gönderimi",
      ]}
    />
  )
}
