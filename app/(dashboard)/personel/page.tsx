import { UsersRound } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function PersonellerPage() {
  return (
    <ComingSoon
      title="Personeller"
      description="Çalışan kartları, sözleşmeler, kimlik bilgileri ve organizasyon şeması — tüm personel kayıtları tek ekranda."
      icon={UsersRound}
      features={[
        "Çalışan profili: kimlik, iletişim, departman, görev",
        "İşe giriş/çıkış tarihleri ve sözleşme bitiş bildirimleri",
        "Departman ve organizasyon hiyerarşisi",
        "İşe alım, performans değerlendirme ve gizli notlar",
      ]}
    />
  )
}
