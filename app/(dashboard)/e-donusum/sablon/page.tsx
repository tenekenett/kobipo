import { LayoutTemplate } from "lucide-react"
import { ComingSoon } from "@/components/dashboard/coming-soon"

export default function FaturaSablonuPage() {
  return (
    <ComingSoon
      title="Fatura Şablonu"
      description="E-Fatura/e-Arşiv PDF görünüm şablonları ve logo, banka, dipnot özelleştirmesi."
      icon={LayoutTemplate}
      features={[
        "Birden çok şablon (klasik, modern, minimal)",
        "Logo, banka bilgileri, KEP adresi ve dipnot alanı",
        "Tasarım önizleme ve örnek PDF",
        "Şube veya belge tipine göre farklı şablon",
      ]}
    />
  )
}
