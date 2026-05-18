import { CalendarCheck } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function IzinDevamPage() {
  return (
    <ComingSoon
      title="İzin-Devam"
      description="Yıllık, mazeret ve hastalık izinleri, giriş/çıkış mesai takibi."
      icon={CalendarCheck}
      features={[
        "İzin talebi oluşturma ve yöneticiye onay akışı",
        "Yıllık izin hakediş ve kalan izin hesabı",
        "Giriş/çıkış (PDKS) günlük rapor",
        "Mazeret/sağlık raporu eki ile dosyalama",
      ]}
    />
  )
}
