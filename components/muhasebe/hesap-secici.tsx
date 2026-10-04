"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { SearchSelect } from "@/components/ui/search-select"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { toast } from "@/components/ui/use-toast"
import { hataBildir, muhasebeIstegi, type PlanHesabi } from "@/components/muhasebe/ortak"

/** Fişe yazılabilir hesaplar (yaprak + aktif) — hesap seçicinin listesi. */
export function useYaprakHesaplar(companyId: string | null) {
  const [hesaplar, setHesaplar] = useState<PlanHesabi[]>([])
  const yenile = useCallback(async () => {
    if (!companyId) return
    try {
      const r = await muhasebeIstegi<{ hesaplar: PlanHesabi[] }>(
        `/api/muhasebe/hesap-plani?companyId=${encodeURIComponent(companyId)}&yaprak=1`,
      )
      setHesaplar(r.hesaplar)
    } catch {
      /* seçici boş kalır; fiş ekranı hatayı kendi gösterir */
    }
  }, [companyId])
  useEffect(() => {
    void yenile()
  }, [yenile])
  return { hesaplar, yenile }
}

/**
 * Hesap seçici — kod veya ada göre (Türkçe duyarsız) arar. Önerilen ana hesabın
 * alt hesapları listenin başına gelir. Listede yoksa "alt hesap aç" satırı yazılan
 * adla önerilen hesabın altına sıradaki alt hesabı açar (Aposkal'daki Ctrl+Enter).
 */
export function HesapSecici({
  companyId,
  hesaplar,
  deger,
  oneriKodu,
  onSec,
  onHesapAcildi,
  disabled,
  hatali,
}: {
  companyId: string
  hesaplar: PlanHesabi[]
  deger: string | null
  oneriKodu?: string | null
  onSec: (id: string | null) => void
  onHesapAcildi?: () => Promise<void> | void
  disabled?: boolean
  hatali?: boolean
}) {
  const { prompt } = useConfirm()
  const secenekler = useMemo(() => {
    const oneri = (oneriKodu ?? "").trim()
    const ilk = oneri ? hesaplar.filter((h) => h.kod === oneri || h.kod.startsWith(`${oneri}.`)) : []
    const ilkSet = new Set(ilk.map((h) => h.id))
    return [...ilk, ...hesaplar.filter((h) => !ilkSet.has(h.id))].map((h) => ({
      id: h.id,
      name: `${h.kod}  ${h.ad}`,
    }))
  }, [hesaplar, oneriKodu])

  const altHesapAc = async (sorgu: string) => {
    const ust = await prompt({
      title: "Alt hesap aç",
      description: "Hangi hesabın altına açılsın? Kod sıradaki numarayla verilir (ör. 770.01).",
      label: "Üst hesap kodu",
      defaultValue: (oneriKodu ?? "").trim(),
      minLength: 3,
      confirmLabel: "Devam",
    })
    if (ust === null) return
    const ad = await prompt({
      title: `${ust.trim()} altına alt hesap`,
      label: "Hesap adı",
      defaultValue: /^\d/.test(sorgu) ? "" : sorgu,
      minLength: 2,
      confirmLabel: "Aç",
    })
    if (ad === null) return
    try {
      const r = await muhasebeIstegi<{ hesap: { id: string; kod: string } }>("/api/muhasebe/hesap-plani", {
        method: "POST",
        body: JSON.stringify({ companyId, ustKod: ust.trim(), ad: ad.trim() }),
      })
      await onHesapAcildi?.()
      onSec(r.hesap.id)
      toast({ title: `${r.hesap.kod} açıldı` })
    } catch (e) {
      hataBildir(e, "Alt hesap açılamadı")
    }
  }

  return (
    <SearchSelect
      options={secenekler}
      value={deger ?? ""}
      onChange={(id) => onSec(id || null)}
      placeholder={oneriKodu ? `${oneriKodu}… hesap seçin` : "Hesap seçin"}
      emptyText="Eşleşen hesap yok"
      disabled={disabled}
      onCreate={altHesapAc}
      createLabel="Alt hesap aç…"
      className={hatali ? "border-red-400 ring-1 ring-red-200 dark:border-red-700" : undefined}
    />
  )
}

