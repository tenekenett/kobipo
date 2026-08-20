import { CafeSaleScreen } from "@/components/restoran/cafe-sale-screen"
import { WriteOnlyScreen } from "@/components/dashboard/write-guard"

// Tezgâh ekranı: burada yapılan tek şey kayıt oluşturmaktır. Salt-okunur
// yetkide düğme gizlemek işe yaramaz — ürünü sepete atıp tamamlayamayan bir
// ekran kalırdı; o yüzden ekran hiç kurulmaz (bkz. write-guard.tsx).
export default function RestoranSatisPage() {
  return (
    <WriteOnlyScreen>
      <CafeSaleScreen />
    </WriteOnlyScreen>
  )
}
