import { FolderOpen } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function InsanKaynaklariPage() {
  return (
    <ComingSoon
      title="İnsan Kaynakları"
      description="Form şablonları, başvuru kayıtları, oryantasyon ve performans dokümanları."
      icon={FolderOpen}
      features={[
        "İşe alım, çıkış mülakat, oryantasyon formu şablonları",
        "Doldurulan form kayıtlarının arşivi",
        "Aday başvurularını e-postadan otomatik içe alma",
        "Personel bazında belge dolabı",
      ]}
    />
  )
}
