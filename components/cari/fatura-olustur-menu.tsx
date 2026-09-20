"use client"

import Link from "next/link"
import { ChevronDown, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Cari kartındaki "Fatura Oluştur" açılır menüsü — müşteri ve tedarikçi kartında
 * AYNI üç seçenek durur; hangisinin tıklanabilir olduğu kartın tarafına bağlıdır.
 *
 * Editör (`/e-donusum/yeni`) satış için `customerId`, alış için `supplierId`
 * ister. Karşı yönlü belge yalnız ikiz kart üzerinden kesilir: tedarikçide
 * "Aynı zamanda müşteri" işaretliyse satış faturası ikiz müşteriye açılır
 * (`linkedCustomerId`), yoksa öğe pasiftir ve sebebini söyler — cari seçilmemiş
 * bir editör açmak kartın bağlamını sessizce düşürürdü.
 *
 * "Alış fiş / faturası" TEK hedeftir: tedarikçiden gelen fiş de fatura da alış
 * faturası olarak kaydedilir (numara elle girilir, GİB'e gitmez).
 */
export type FaturaOlusturMenuProps = {
  companyId: string
  kind: "customer" | "supplier"
  /** Kartın kendi id'si (slug değil — editör id bekler). */
  cariId: string
  /** İkiz kartın id'si: müşteride `linkedSupplierId`, tedarikçide `linkedCustomerId`. */
  linkedId?: string | null
  /** Editörün "Listeye dön" düğmesinin geri döneceği yol (`/cari/...`). */
  from: string
}

export function FaturaOlusturMenu({ companyId, kind, cariId, linkedId, from }: FaturaOlusturMenuProps) {
  const customerId = kind === "customer" ? cariId : linkedId || null
  const supplierId = kind === "supplier" ? cariId : linkedId || null

  const editorHref = (type: "SALES" | "PURCHASE", counterparty: string) => {
    const query = new URLSearchParams({ company: companyId, type, from })
    query.set(type === "SALES" ? "customerId" : "supplierId", counterparty)
    return `/e-donusum/yeni?${query.toString()}`
  }

  const items: Array<{
    key: string
    label: string
    href: string | null
    hint: string
  }> = [
    {
      key: "sales",
      label: "Satış Faturası Oluştur",
      href: customerId ? editorHref("SALES", customerId) : null,
      hint: customerId
        ? "E-Fatura / E-Arşiv / manuel"
        : "Tedarikçi aynı zamanda müşteri değil — kartı düzenleyip işaretleyin",
    },
    {
      key: "purchase",
      label: "Alış Fiş / Faturası Oluştur",
      href: supplierId ? editorHref("PURCHASE", supplierId) : null,
      hint: supplierId
        ? "Gelen fiş veya faturayı kaydet"
        : "Müşteri aynı zamanda tedarikçi değil — kartı düzenleyip işaretleyin",
    },
    {
      // İhracat (IHRACAT profili + gümrük alanları) editörde henüz yok; pasif
      // öğe kullanıcıya bunu söyler, SALES editörüne yönlendirmez.
      key: "export",
      label: "İhracat Faturası Oluştur",
      href: null,
      hint: "Henüz desteklenmiyor",
    },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm">
          <FileText className="mr-2 h-4 w-4" />
          Fatura Oluştur
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {/* Düzen (iki satır) İÇ sarmalayıcıda: `asChild` ile Link'e verilen
            `items-start`, öğenin kendi `items-center`ıyla çakışıp kaybediyordu
            (Radix Slot sınıfları twMerge'siz birleştirir) ve aktif öğe
            ortalanıyor, pasifler solda kalıyordu. */}
        {items.map((item) => {
          const body = (
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-sm">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.hint}</span>
            </span>
          )
          return item.href ? (
            <DropdownMenuItem key={item.key} asChild>
              <Link href={item.href} className="cursor-pointer">
                {body}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.key} disabled>
              {body}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
