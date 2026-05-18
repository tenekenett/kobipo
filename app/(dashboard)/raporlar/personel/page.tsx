import { Users } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function PersonelRaporlariPage() {
  return (
    <ComingSoon
      title="Personel Raporları"
      description="Personel maliyet, izin kullanım ve bordro özet raporları — Personel modülü ile birlikte aktifleşecek."
      icon={Users}
      features={[
        "Personel Maliyet Raporu (brüt/net + işveren payları)",
        "İzin Kullanım Raporu (yıllık/mazeret/sağlık dağılımı)",
        "Bordro Özet Raporu (departman/şube kırılımlı)",
        "Yıllık personel devir oranı",
      ]}
    />
  )
}
