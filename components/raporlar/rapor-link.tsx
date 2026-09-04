"use client"

import Link from "next/link"
import type { MouseEvent, ReactNode } from "react"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { withCompanyHref } from "@/lib/company/href"
import { cn } from "@/lib/utils"

/**
 * Rapor satırlarındaki ürün / cari / belge adını kendi sayfasına bağlayan link.
 *
 * Rapor bir soruyu cevaplar ("hangi üründen kaç tane sattım", "kim ne kadar
 * borçlu"); cevabın hemen ardından kaydın kendisi gerekir. Adlar ve belge
 * numaraları düz metinken kullanıcı kaydı ilgili ekranda ELLE aramak zorunda
 * kalıyordu.
 *
 * Gerçek `<a>` basılır (satır `onClick`i + `router.push` DEĞİL): kullanıcı orta
 * tuş / Ctrl+tık ile raporu kaybetmeden yeni sekmede açabilsin. Rapor süzgeçleri
 * (tarih aralığı, sınıflandırma, arama) ekran durumunda yaşar, URL'de değil —
 * aynı sekmede gidip geri dönmek onları sıfırlar.
 *
 * Link iki durumda BASILMAZ, ad düz metin kalır:
 *  - Kimlik yoksa: serbest fatura kalemi bir ürün kartına, carisiz perakende
 *    satış bir cari kartına bağlı değildir; tıklanabilir görünmeleri yanıltır.
 *  - Hedef sayfa o kullanıcıya kapalıysa: rapor açık ama kart kapalı olabilir
 *    (ör. Gözlemci). Süzmezsek link kullanıcıyı sayfa kapısına çarpıp panoya
 *    attırır — yaşlandırma raporundaki profil düğmesi de aynı sebeple süzülüyor.
 *
 * `?company=` her iki linkte de taşınır (bkz. CLAUDE.md "Panel linkleri").
 */

const LINK_CLASS = "font-medium text-primary underline-offset-2 hover:underline"

type CommonProps = {
  /** Aktif firma/şube — raporun verisi de bu firmaya aittir. */
  companyId: string | null | undefined
  children: ReactNode
  className?: string
  /**
   * Satırın kendi tıklaması varsa (ör. yaşlandırma tablosunda aç/kapa) linkin
   * tıklaması ona da düşmesin.
   */
  stopRowClick?: boolean
}

/**
 * Yolu açabiliyorsak link, açamıyorsak düz metin.
 *
 * `path` ile `query` AYRI durur: kapı denetimi (`canOpen`) çıplak yol bekler,
 * query'li bir dizge en uzun-ön-ek eşleşmesini bozar.
 */
function EntityLink({
  path,
  query,
  companyId,
  className,
  children,
  stopRowClick,
}: CommonProps & { path: string; query?: string }) {
  const canOpen = useRouteAccess()
  const onClick = stopRowClick
    ? (event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()
    : undefined

  if (!canOpen(path)) return <>{children}</>

  return (
    <Link
      href={withCompanyHref(`${path}${query ?? ""}`, companyId)}
      className={cn(LINK_CLASS, className)}
      onClick={onClick}
    >
      {children}
    </Link>
  )
}

/**
 * Ürün kartı linki. `productRef` ürünün slug'ı ya da id'si olabilir —
 * `/stok/[id]` ikisini de çözer.
 */
export function ProductLink({
  productRef,
  children,
  ...rest
}: CommonProps & { productRef: string | null | undefined }) {
  if (!rest.companyId || !productRef) return <>{children}</>
  return (
    <EntityLink path={`/stok/${productRef}`} {...rest}>
      {children}
    </EntityLink>
  )
}

/**
 * Belge linki — fatura ya da FİŞ.
 *
 * İkisi de `Invoice` satırıdır ama AYRI sayfalara gider: fişi
 * `/faturalar/.../onizleme`de açmak onu "Satış Faturası" başlığıyla gösterir,
 * restoran fişi fatura değildir (bkz. restoran karlılık raporundaki `belgeHref`).
 *
 * `from` verilirse belgenin "Geri" düğmesi kendi listesine değil rapora döner.
 */
export function BelgeLink({
  belgeId,
  isReceipt,
  from,
  children,
  ...rest
}: CommonProps & {
  belgeId: string | null | undefined
  isReceipt?: boolean
  from?: string
}) {
  if (!rest.companyId || !belgeId) return <>{children}</>
  return (
    <EntityLink
      path={isReceipt ? `/fisler/${belgeId}` : `/faturalar/${belgeId}/onizleme`}
      query={from ? `?from=${encodeURIComponent(from)}` : undefined}
      {...rest}
    >
      {children}
    </EntityLink>
  )
}

/**
 * Cari kartı linki. Adres yönü kartın türünden gelir: müşteri `/cari/customers`,
 * tedarikçi `/cari/suppliers`. `from` verilirse detay sayfasının "geri" düğmesi
 * cari listesine değil, gelinen rapora döner.
 */
export function CariLink({
  kind,
  cariRef,
  from,
  children,
  ...rest
}: CommonProps & {
  kind: "customer" | "supplier"
  cariRef: string | null | undefined
  from?: string
}) {
  if (!rest.companyId || !cariRef) return <>{children}</>
  const segment = kind === "customer" ? "customers" : "suppliers"
  return (
    <EntityLink
      path={`/cari/${segment}/${cariRef}`}
      query={from ? `?from=${encodeURIComponent(from)}` : undefined}
      {...rest}
    >
      {children}
    </EntityLink>
  )
}
