"use client"

/**
 * Belge onay kartlarının ORTAK parçaları — rozetler, uyarılar, engel kutusu,
 * yön seçici, cari seçici, kaydedildi hâli. Fiş kartı (fis-onay-karti.tsx)
 * kendi kopyalarını KORUR (plan §2: fiş yolu dokunulmaz); yeni kartlar buradan
 * çeker.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { QuickCariDialog, useCanCreateCari } from "@/components/e-donusum/quick-cari-dialog"
import { useCustomers, useSuppliers } from "@/lib/swr/use-company-data"
import type { Denetim, Yon } from "@/lib/belge-ocr/turler"
import { unvanEslesiyorMu } from "@/lib/belge-ocr/sinif/normalize"
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react"

export const tl = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

export const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")
export const metin = (v: unknown) => (v == null ? "" : String(v))

export function Alan({ etiket, className, children }: { etiket: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs font-medium text-muted-foreground">{etiket}</label>
      {children}
    </div>
  )
}

export function DenetimRozeti({ d }: { d: Denetim }) {
  const stil =
    d.durum === "gecti"
      ? "bg-kobipo-green-light text-kobipo-green-dark"
      : d.durum === "patladi"
        ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        : "bg-kobipo-offwhite text-kobipo-gray"
  const isaret = d.durum === "gecti" ? "✓" : d.durum === "patladi" ? "✗" : "—"
  return (
    <span title={d.aciklama} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stil}`}>
      {isaret} {d.etiket}
    </span>
  )
}

export function DenetimSeridi({ denetimler, ekRozetler }: { denetimler: Denetim[]; ekRozetler?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {denetimler.map((d) => (
        <DenetimRozeti key={d.anahtar} d={d} />
      ))}
      {ekRozetler}
    </div>
  )
}

export function KaynakRozeti({ yol }: { yol: string }) {
  const etiket =
    yol === "xml" ? "UBL XML — modelsiz" : yol === "karekod+model" ? "Karekod + model" : yol === "metin" ? "PDF metin katmanı" : "Görsel"
  return <span className="inline-flex items-center rounded-full bg-kobipo-blue/10 px-2.5 py-0.5 text-[11px] font-semibold text-kobipo-blue">{etiket}</span>
}

export function UyariListesi({ uyarilar }: { uyarilar: Array<{ mesaj: string; agir?: boolean }> }) {
  if (uyarilar.length === 0) return null
  return (
    <ul className="space-y-1">
      {uyarilar.map((u, i) => (
        <li key={i} className={`flex items-start gap-2 rounded-md px-2 py-1 text-xs ${u.agir ? "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : "bg-kobipo-offwhite text-muted-foreground"}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{u.mesaj}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Engel kutusu — fişteki kural: patlayan denetim / ağır uyarı / mükerrer kaydı
 * kilitler, TEK onay kutusuyla aşılır. Mükerrer bilgisi ekrana yeni geldiyse
 * kutu sıfırlanır (çağıran yapar).
 */
export function EngelKutusu({
  patlayan,
  agir,
  mukerrer,
  ragmen,
  onRagmen,
  aciklama,
}: {
  patlayan: number
  agir: number
  mukerrer: React.ReactNode | null
  ragmen: boolean
  onRagmen: (v: boolean) => void
  aciklama: React.ReactNode
}) {
  const engelVar = patlayan > 0 || agir > 0 || !!mukerrer
  if (!engelVar) return <span className="text-xs text-muted-foreground">{aciklama}</span>
  return (
    <div className="space-y-1">
      {mukerrer && <div className="text-xs text-amber-900 dark:text-amber-200">{mukerrer}</div>}
      <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
        <input type="checkbox" checked={ragmen} onChange={(e) => onRagmen(e.target.checked)} className="h-4 w-4" />
        {patlayan > 0 ? `${patlayan} denetim tutmuyor` : mukerrer ? "Mükerrer olabilir" : "Uyarı var"}, yine de kaydet
      </label>
    </div>
  )
}

export function KaydedildiKarti({ baslik, aciklama, href, hrefEtiketi }: { baslik: string; aciklama: string; href?: string | null; hrefEtiketi?: string }) {
  return (
    <Card className="border-kobipo-green">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-5 w-5 text-kobipo-green-dark" />
          <span>
            <strong>{baslik}</strong> — {aciklama}
          </span>
        </div>
        {href && (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {hrefEtiketi ?? "Kaydı aç"}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

/** Alış / satış seçici — sınıflandırıcının yön kararı burada düzeltilir. */
export function YonSecici({ yon, dayanak, onChange, alisEtiketi, satisEtiketi }: { yon: Yon; dayanak?: string; onChange: (y: Yon) => void; alisEtiketi: string; satisEtiketi: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="inline-flex overflow-hidden rounded-md border border-kobipo-border">
        {(["ALIS", "SATIS"] as const).map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => onChange(y)}
            className={`px-3 py-1 font-semibold transition ${yon === y ? "bg-kobipo-blue text-white" : "bg-background text-muted-foreground hover:bg-kobipo-offwhite"}`}
          >
            {y === "ALIS" ? alisEtiketi : satisEtiketi}
          </button>
        ))}
      </div>
      {yon === "BELIRSIZ" ? (
        <span className="text-amber-700">Yön belirlenemedi — seçin</span>
      ) : dayanak === "vkn" ? (
        <span className="text-muted-foreground">VKN eşleşmesinden</span>
      ) : dayanak === "unvan" ? (
        <span className="text-muted-foreground">Ünvan benzerliğinden (kontrol edin)</span>
      ) : null}
    </div>
  )
}

/**
 * Cari seçici: VKN ile otomatik eşleşme, yoksa listeden seçim, yoksa hızlı kart.
 * Alışta tedarikçi, satışta müşteri. Kart açma yetkisi /cari/* sayfasından gelir.
 */
export function CariSecici({
  companyId,
  kind,
  vkn,
  unvan,
  value,
  onChange,
  zorunlu,
}: {
  companyId: string
  kind: "supplier" | "customer"
  vkn: string
  unvan: string
  value: string
  onChange: (id: string) => void
  zorunlu?: boolean
}) {
  const { suppliers, mutate: tedarikciTazele } = useSuppliers(kind === "supplier" ? companyId : null)
  const { customers, mutate: musteriTazele } = useCustomers(kind === "customer" ? companyId : null)
  const liste = kind === "supplier" ? suppliers : customers
  const [acik, setAcik] = useState(false)
  const yetki = useCanCreateCari()
  const acilabilir = kind === "supplier" ? yetki.supplier : yetki.customer
  // Önce VKN (kesin), yoksa ünvan benzerliği (zayıf — dekont ve çekte VKN
  // basılmaz, tek ipucu ad). Ünvan eşleşmesi seçilir ama "kontrol edin" denir.
  const vknEslesen = useMemo(() => (vkn ? liste.find((c) => rakam(c.taxNumber) === vkn) : undefined), [liste, vkn])
  const unvanEslesen = useMemo(
    () => (!vknEslesen && unvan ? liste.find((c) => unvanEslesiyorMu(c.name, unvan)) : undefined),
    [liste, vknEslesen, unvan]
  )
  const eslesen = vknEslesen ?? unvanEslesen
  useEffect(() => {
    if (eslesen && !value) onChange(eslesen.id)
  }, [eslesen, value, onChange])
  const etiket = kind === "supplier" ? "Tedarikçi" : "Müşteri"

  return (
    <div className="rounded-md border border-kobipo-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Alan etiket={etiket} className="min-w-[260px] flex-1">
          <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
            <option value="">— seçilmedi —</option>
            {liste.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.taxNumber ? ` · ${c.taxNumber}` : ""}
              </option>
            ))}
          </select>
        </Alan>
        {!eslesen && vkn && acilabilir && (
          <Button variant="outline" size="sm" onClick={() => setAcik(true)}>
            Bu VKN ile {etiket.toLowerCase()} oluştur
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {vknEslesen ? (
          <>
            VKN <span className="font-mono">{vkn}</span> kayıtlı {etiket.toLowerCase()}yle eşleşti.
          </>
        ) : unvanEslesen && value === unvanEslesen.id ? (
          <>
            Ünvan benzerliğinden <strong>{unvanEslesen.name}</strong> seçildi — belgede VKN yok, kontrol edin.
          </>
        ) : value ? (
          <>Seçtiğiniz carinin VKN&apos;si belgedeki numaradan farklı. Kayıt yine de bu cariye işlenir.</>
        ) : zorunlu ? (
          <>
            <strong className="text-foreground">{etiket} seçilmeden kaydedilemez.</strong>
            {!acilabilir && " Yeni cari açma yetkiniz yok; listeden mevcut bir cari seçin."}
          </>
        ) : (
          <>Cari seçilmezse kayıt hiçbir cari ekstresinde görünmez.</>
        )}
      </p>
      <QuickCariDialog
        open={acik}
        onOpenChange={setAcik}
        companyId={companyId}
        defaultKind={kind}
        initialName={unvan}
        initialTaxNumber={vkn}
        requireTaxFields={false}
        onCreated={(created) => {
          onChange(created.id)
          if (kind === "supplier") tedarikciTazele()
          else musteriTazele()
        }}
      />
    </div>
  )
}

/** Mükerrer kaydı işaretle: `sorgu` anahtarı değişince sonuç bayatlar (fişteki kural). */
export type MukerrerDurumu = { sorgu: string; kayit: { id: string; no: string | null; slug: string | null; total: number | null; anahtar: string } | null }

export async function mukerrerSor(params: Record<string, string | null | undefined>): Promise<MukerrerDurumu["kayit"]> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const r = await fetch(`/api/alis/belge-tarama/mukerrer?${qs}`)
  const j = await r.json().catch(() => ({}))
  return r.ok && j?.mukerrer ? j.mukerrer : null
}

/** Ekranın gelen kutusunu tazelemesi için kart → ekran olayı (prop zinciri yerine). */
export const KAYDEDILDI_OLAYI = "belge-tarama:kaydedildi"

/** Kaydın tarama satırına izini yazar; satır tüm belgeler bağlanınca SAVED olur. */
export async function hedefYaz(scanId: string | null, index: number, type: string, id: string, no: string | null, slug?: string | null) {
  if (!scanId) return
  const r = await fetch(`/api/alis/belge-tarama/${scanId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "hedef", index, type, id, no, slug }),
  }).catch(() => null)
  const satir = r && r.ok ? await r.json().catch(() => null) : null
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KAYDEDILDI_OLAYI, { detail: { scanId, status: satir?.status ?? null, targets: satir?.targets ?? null } }))
  }
}
