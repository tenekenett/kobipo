"use client"

import { SWRConfig } from "swr"
import { jsonFetcher } from "@/lib/swr/fetcher"

// Panel genelinde SWR yapılandırması.
// - fetcher: ortak JSON fetcher (hook'larda tek tek geçmeye gerek kalmaz).
// - revalidateOnFocus: false → referans veri her sekme odağında yeniden çekilmez.
// - dedupingInterval: aynı anahtara 30 sn içinde gelen istekler tek isteğe indirilir.
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: jsonFetcher,
        revalidateOnFocus: false,
        dedupingInterval: 30000,
      }}
    >
      {children}
    </SWRConfig>
  )
}
