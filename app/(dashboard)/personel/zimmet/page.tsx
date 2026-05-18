import { BadgeCheck } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function ZimmetPage() {
  return (
    <ComingSoon
      title="Zimmet"
      description="Personele teslim edilen demirbaş, ekipman ve araçların takibi."
      icon={BadgeCheck}
      features={[
        "Zimmet kaydı ve teslim/iade formu PDF",
        "Demirbaş envanteri ve seri no eşleştirme",
        "Personel kartından zimmet geçmişi",
        "İade hatırlatma bildirimleri",
      ]}
    />
  )
}
