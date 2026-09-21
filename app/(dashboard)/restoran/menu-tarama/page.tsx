import { MenuTaramaScreen } from "@/components/restoran/menu-tarama/menu-tarama-screen"

// Menü Tarama — kafenin basılı menüsünün fotoğrafı/PDF'i → satılabilir ürün
// (docs/menu-tarama/PLAN.md). DENEME sayfası: MENU_TARAMA_COMPANIES beyaz listesi.
//
// Ekran salt-okunurda da KURULUR (WriteOnlyScreen değil): okuma ve kaydet
// düğmeleri WriteAction ile gizli, sürükle-bırak yolu useWriteGuard ile süzülüyor.
export default function MenuTaramaPage() {
  return <MenuTaramaScreen />
}
