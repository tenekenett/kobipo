import { redirect } from "next/navigation"
import { withCompanyHref } from "@/lib/company/href"

// Bu rapor artık sekmeli sayfada yaşıyor (/restoran/raporlar). Adres, daha önce
// paylaşılmış linkler ve tarayıcı yer imleri kırılmasın diye yönlendirme olarak
// korunuyor. Bkz. docs/restoran/SADELESTIRME.md "İş 3".
//
// `?company=` AYNEN taşınır: yönlendirme param'ı düşürürse kullanıcı seçili
// şubeden çıkar ve raporu yanlış firma için görür.
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : null
  redirect(withCompanyHref("/restoran/raporlar?rapor=karlilik", company))
}
