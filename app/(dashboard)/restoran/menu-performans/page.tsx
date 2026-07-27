import { redirect } from "next/navigation"

// Bu rapor artık sekmeli sayfada yaşıyor (/restoran/raporlar). Adres, daha önce
// paylaşılmış linkler ve tarayıcı yer imleri kırılmasın diye yönlendirme olarak
// korunuyor. Bkz. docs/restoran/SADELESTIRME.md "İş 3".
export default function Page() {
  redirect("/restoran/raporlar?rapor=menu")
}
