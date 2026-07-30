"use client"

// Yükleme hatasının metni. Kabuk (Card / boş div) çağıranın işi — hata kutusunun
// yerleşimi ekrandan ekrana değişiyor, DEĞİŞMEMESİ gereken şey cümlenin kendisi:
// ağ kopukluğu ile sunucu hatası her yerde aynı ayrımla anlatılsın.

import { describeFetchError } from "@/lib/swr/fetcher"

export function FetchErrorText({ error, subject }: { error: unknown; subject: string }) {
  const { message, detail } = describeFetchError(error, subject)
  return (
    <>
      <p>{message}</p>
      {/* Sunucunun kendi cümlesi (varsa) ikinci satırda: asıl mesajı boğmasın
          ama teşhis için görünsün. */}
      {detail && <p className="mt-1.5 text-xs opacity-75">{detail}</p>}
    </>
  )
}
