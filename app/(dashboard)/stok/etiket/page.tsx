import { LabelDesignerScreen } from "@/components/stok/label-designer/label-designer-screen"
import { ExportOnlyScreen } from "@/components/dashboard/write-guard"

// Etiket Tasarımcısı — ürün etiketi tasarlama ve yazdırma (rulo/A4).
//
// Ekran baştan sona çıktı üretmek içindir (tasarla → bas); salt-okunur üyelikte tek
// tek düğme gizlemek basılamayan bir tasarımcı bırakırdı.
export default function EtiketPage() {
  return (
    <ExportOnlyScreen>
      <LabelDesignerScreen />
    </ExportOnlyScreen>
  )
}
