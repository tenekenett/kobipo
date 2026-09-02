import { FisTaramaScreen } from "@/components/alis/fis-tarama-screen"

// Fiş Tarama — fiş fotoğrafından alış fişi.
//
// Ekran salt-okunurda da KURULUR (WriteOnlyScreen değil): tarama düğmesi ve
// kaydet düğmesi zaten WriteAction ile gizli, sürükle-bırak yolu useWriteGuard
// ile süzülüyor. Ekranı hiç kurmamak, yetkisi olmayanın sayfayı açtığında
// nedenini görmesini de engellerdi.
export default function FisTaramaPage() {
  return <FisTaramaScreen />
}
