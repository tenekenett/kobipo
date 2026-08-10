"use client"

// "Masaya adisyon aç" davranışının TEK tanımı.
//
// İki ekran aynı işi yapıyor: salon planı (kroki üzerinden) ve masa listesi
// (hızlı kullanım). Ayrı ayrı yazılsalardı biri 409 çakışmasını ya da rezerve
// masa kuralını unuttuğu an iki ekran farklı davranırdı — MenuGrid ve
// TicketPanel'in ortak olma gerekçesinin aynısı.
//
// Ekranların GÖRÜNÜMÜ ortak değil (biri kroki, diğeri liste); ortak olan yalnız
// karar ve uç çağrıları.

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import type { KeyedMutator } from "swr"
import { withCompanyHref } from "@/lib/company/href"
import { useToast } from "@/components/ui/use-toast"
import type { PlanTable } from "@/lib/swr/use-restoran"

/**
 * Masaya dokunulduğunda ne olmalı?
 *
 *  "ticket" → açık adisyon var, oraya git.
 *  "ask"    → belirsiz durum (toplanacak / rezerve): önce ne yapılacağı sorulur.
 *             Rezerve masaya gelen geçen müşteriyi oturtmak rezervasyonu yakardı.
 *  "open"   → boş masa, doğrudan adisyon açılır (garsonun en sık yaptığı iş tek
 *             dokunuşta kalmalı).
 */
export function tableTapIntent(table: PlanTable): "ticket" | "ask" | "open" {
  if (table.openTicket) return "ticket"
  if (table.cleaningSince || table.reservation) return "ask"
  return "open"
}

export function useTableOpener(companyId: string | null, mutate: KeyedMutator<PlanTable[]>) {
  const router = useRouter()
  const { toast } = useToast()
  /** Uç yanıtı beklenen masa — kart üzerinde dönen gösterge için. */
  const [busyTableId, setBusyTableId] = useState<string | null>(null)

  const openTicketFor = useCallback(
    async (table: PlanTable, reservationId?: string) => {
      setBusyTableId(table.id)
      try {
        const res = await fetch("/api/restoran/adisyonlar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, tableId: table.id, reservationId }),
        })
        const body = await res.json().catch(() => ({}))
        // 409 = bu masaya başka biri adisyon açmış; sunucu mevcut adisyonu
        // döndürüyor, kullanıcıyı hata ekranına düşürmeden oraya götürüyoruz.
        if (res.status === 409 && body?.ticket?.id) {
          void mutate()
          router.push(withCompanyHref(`/restoran/adisyon/${body.ticket.id}`, companyId))
          return
        }
        if (!res.ok) throw new Error(body?.error || "Adisyon açılamadı")
        void mutate()
        router.push(withCompanyHref(`/restoran/adisyon/${body.id}`, companyId))
      } catch (e: any) {
        toast({ title: "Adisyon açılamadı", description: e.message, variant: "destructive" })
      } finally {
        setBusyTableId(null)
      }
    },
    [companyId, mutate, router, toast],
  )

  const goToTicket = useCallback(
    (ticketId: string) => router.push(withCompanyHref(`/restoran/adisyon/${ticketId}`, companyId)),
    [companyId, router],
  )

  const markCleaned = useCallback(
    async (table: PlanTable) => {
      // İyimser güncelleme: "toplandı" tek dokunuşluk bir işaret, uç yanıtını
      // beklerken masanın kesikli çerçevede kalması gecikme gibi görünüyordu.
      await mutate(
        (prev) => (prev ?? []).map((t) => (t.id === table.id ? { ...t, cleaningSince: null } : t)),
        { revalidate: false },
      )
      try {
        const res = await fetch(`/api/restoran/masalar/${table.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, cleaned: true }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Güncellenemedi")
      } catch (e: any) {
        toast({ title: "Güncellenemedi", description: e.message, variant: "destructive" })
      } finally {
        void mutate()
      }
    },
    [companyId, mutate, toast],
  )

  const markNoShow = useCallback(
    async (table: PlanTable) => {
      if (!table.reservation) return
      try {
        const res = await fetch(`/api/restoran/rezervasyonlar/${table.reservation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, status: "NOSHOW" }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Güncellenemedi")
        toast({ title: "Rezervasyon 'gelmedi' işaretlendi" })
      } catch (e: any) {
        toast({ title: "Güncellenemedi", description: e.message, variant: "destructive" })
      } finally {
        void mutate()
      }
    },
    [companyId, mutate, toast],
  )

  return { busyTableId, openTicketFor, goToTicket, markCleaned, markNoShow }
}
