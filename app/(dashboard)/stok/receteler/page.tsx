import { redirect } from "next/navigation"

// Reçete ekranı Restoran & Kafe grubuna taşındı (/restoran/menu): kurulum ve
// kullanım artık aynı menü grubunda. Bu adres, daha önce paylaşılmış linkler
// kırılmasın diye yönlendirme olarak korunuyor.
//
// NOT: Taşınan yalnız EKRAN. Reçete mantığı (lib/stock/recipe*.ts) Stok'ta
// kalıyor — reçete restorana özgü bir kavram değil (PLAN.md "Adım 1").
export default function Page() {
  redirect("/restoran/menu")
}
