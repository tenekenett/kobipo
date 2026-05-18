import { Zap } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function HizliAlisFisiPage() {
  return (
    <ComingSoon
      title="Hızlı Alış Fişi"
      description="Tedarikçiden gelen ufak alımlar için hızlı fiş kaydı — fatura beklemeden gideri ve stok girişini işleyin."
      icon={Zap}
      features={[
        "Tek ekranda kalemleri ve tedarikçiyi gir",
        "Stoktan kalem seçerek otomatik depo girişi",
        "Nakit/kart ödemesi ile gider kaydı",
        "Sonradan fatura geldiğinde fişe bağlama",
      ]}
    />
  )
}
