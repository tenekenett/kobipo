import { BelgeTaramaScreen } from "@/components/alis/fis-tarama-screen"

// Belge Tarama — fotoğraf / PDF / UBL XML'den fiş, fatura, irsaliye, dekont,
// çek/senet kaydı. URL /alis/fis-tarama KALIR (page-access kuralları tek sayfada
// toplu; plan §3.9).
//
// Ekran salt-okunurda da KURULUR (WriteOnlyScreen değil): okuma ve kaydet
// düğmeleri WriteAction ile gizli, sürükle-bırak yolu useWriteGuard ile
// süzülüyor. Ekranı hiç kurmamak, yetkisi olmayanın sayfayı açtığında nedenini
// görmesini de engellerdi.
export default function BelgeTaramaPage() {
  return <BelgeTaramaScreen />
}
