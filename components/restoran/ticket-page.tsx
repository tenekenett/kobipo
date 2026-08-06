"use client"

// Adisyon sayfasının KİP SEÇİCİSİ — tek URL, iki ekran.
// Kararlar: docs/restoran/ADISYON-DETAY.md K1
//
// URL adisyonun kimliğidir ve hesap kapanınca DEĞİŞMEZ: açıkken paylaşılmış ya
// da yer imlenmiş bir link kapandıktan sonra da çalışmalı. Bu yüzden ayrı bir
// /detay yolu yok; hangi ekranın basılacağına burada karar veriliyor.
//
//   OPEN                → <TicketScreen>        POS çalışma ekranı
//   CLOSED | CANCELLED  → <TicketDetailScreen>  salt okunur denetim ekranı
//
// Yükleme/hata durumu iki çocuğa DEVREDİLMİYOR, burada basılıyor: TicketScreen
// ürün/reçete/depo SWR'larını mount olur olmaz kuruyor. Kapalı bir adisyonda
// "bilmiyorken POS'u bas, sonra değiştir" yaklaşımı o ağır istekleri boşuna
// tetiklerdi (K2'nin kaçındığı maliyetin aynısı).

import { useRef } from "react"
import { ArrowLeft } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useTicket } from "@/lib/swr/use-restoran"
import { TicketScreen } from "@/components/restoran/ticket-screen"
import { TicketDetailScreen } from "@/components/restoran/ticket-detail-screen"

export function TicketPage({ ticketId }: { ticketId: string }) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  // TicketScreen ile AYNI SWR anahtarı (`?detail=1` yok) — açık adisyonda ek
  // istek çıkmaz, ekran cache'ten dolu açılır.
  const { ticket, error } = useTicket(companyId, ticketId)

  /**
   * Kip ilk BAŞARILI yüklemede DONDURULUR, `status` değiştikçe değil.
   * Aksi halde kasiyer hesabı kapatır kapatmaz `mutate` yeni durumu getirir,
   * ekran detay kipine atlar ve POS'un "Hesap kapatıldı" penceresi
   * (Fişi göster / Yazdır / Masalara dön) daha görünmeden unmount olur.
   *
   * Ref bilerek: yalnız bir kez, aynı değere yazılıyor — render'ı tekrarlamak
   * sonucu değiştirmiyor ve state olsaydı ilk çizim bir kip geriden gelirdi.
   */
  const mode = useRef<"pos" | "detail" | null>(null)
  if (mode.current === null && ticket) {
    mode.current = ticket.status === "OPEN" ? "pos" : "detail"
  }

  if (mode.current === "pos") return <TicketScreen ticketId={ticketId} />
  if (mode.current === "detail") return <TicketDetailScreen ticketId={ticketId} />

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  // Kip daha bilinmiyor. Dönüş linki Adisyonlar: açık mı kapalı mı bilinmeyen
  // bir hesabın iki listesinden de kapsayıcı olanı burasıdır.
  return (
    <div className="space-y-4">
      <CompanyLink
        href="/restoran/adisyonlar"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Adisyonlar
      </CompanyLink>
      <Card>
        <CardContent
          className={
            error
              ? "py-16 text-center text-sm text-red-600 dark:text-red-400"
              : "py-16 text-center text-sm text-muted-foreground"
          }
        >
          {error ? <FetchErrorText error={error} subject="Adisyon" /> : "Adisyon yükleniyor…"}
        </CardContent>
      </Card>
    </div>
  )
}
