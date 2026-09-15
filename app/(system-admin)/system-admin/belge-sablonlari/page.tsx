import { FileText } from "lucide-react"
import { DocumentTemplateAdmin } from "@/components/system-admin/document-template-admin"

export const dynamic = "force-dynamic"

export default function SystemAdminBelgeSablonlariPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FileText className="h-8 w-8 text-indigo-400" />
          İK Belge Şablonları
        </h1>
        <p className="text-slate-400 mt-1">
          Kobipo&apos;nun tüm firmalara sunduğu hazır İK belgeleri (izin talebi, çalışma
          belgesi, fesih bildirimi…). Firma, Personel → Belge Şablonları ekranında bunları
          görür; düzenlemek istediğinde kalıp kendi kopyasına alınır ve buradaki
          değişiklikler o firmaya artık yansımaz.
        </p>
      </div>

      <DocumentTemplateAdmin />
    </div>
  )
}
