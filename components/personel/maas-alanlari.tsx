"use client"

/**
 * Brüt ↔ net maaş alanları — personel kartındaki ücret bölümü.
 *
 * Hangisine yazılırsa öteki HESAPLANIR (lib/personel/bordro-hesap.ts). İşletme
 * çalışanla çoğu zaman net üzerinden anlaşır, SGK ve bordro ise brüt ister;
 * çevrimi kullanıcıya bıraktığımız sürece personel kartına elle bulunmuş,
 * birbirini tutmayan iki rakam giriyordu.
 *
 * SÖZLEŞME UCU DA KAYDEDİLİR (`salaryBasis`): net anlaşmada brüt her ay yeniden
 * çözülmelidir, çünkü gelir vergisi kümülatif matrahtan hesaplanır ve aynı brüt
 * yıl ilerledikçe daha az net verir. Hangi rakamın sabit olduğunu bilmeyen bir
 * bordro, yılın ortasında sessizce yanlış tarafı sabitler.
 *
 * BURADAKİ RAKAM SÖZLEŞME RAKAMIDIR, ayın kesin neti değil: hesap yıl başı
 * (kümülatif matrah sıfır) varsayımıyla yapılır ve bu ekranda yazıyla söylenir.
 */

import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { money } from "@/lib/format"
import { brutenNete, nettenBrute } from "@/lib/personel/bordro-hesap"

export type MaasBasis = "GROSS" | "NET"

export type MaasDegeri = {
  grossSalary: string
  netSalary: string
  salaryBasis: MaasBasis
}

const num = (v: string) => {
  const n = Number(String(v).replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

const fmtInput = (n: number) => (n > 0 ? n.toFixed(2) : "")

export function MaasAlanlari({
  value,
  disabled,
  onChange,
}: {
  value: MaasDegeri
  disabled?: boolean
  onChange: (next: MaasDegeri) => void
}) {
  const year = new Date().getFullYear()

  const detay = useMemo(() => {
    const gross = num(value.grossSalary)
    if (gross <= 0) return null
    return brutenNete(gross, { year, month: 1 })
  }, [value.grossSalary, year])

  function setGross(raw: string) {
    const gross = num(raw)
    onChange({
      grossSalary: raw,
      netSalary: gross > 0 ? fmtInput(brutenNete(gross, { year, month: 1 }).net) : "",
      salaryBasis: "GROSS",
    })
  }

  function setNet(raw: string) {
    const net = num(raw)
    onChange({
      grossSalary: net > 0 ? fmtInput(nettenBrute(net, { year, month: 1 }).gross) : "",
      netSalary: raw,
      salaryBasis: "NET",
    })
  }

  return (
    <>
      <div>
        <Label>Brüt Maaş (₺)</Label>
        <Input
          type="number"
          step="0.01"
          inputMode="decimal"
          value={value.grossSalary}
          disabled={disabled}
          onChange={(e) => setGross(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {value.salaryBasis === "GROSS" ? "Anlaşma brüt üzerinden" : "Net maaştan hesaplandı"}
        </p>
      </div>
      <div>
        <Label>Net Maaş (₺)</Label>
        <Input
          type="number"
          step="0.01"
          inputMode="decimal"
          value={value.netSalary}
          disabled={disabled}
          onChange={(e) => setNet(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {value.salaryBasis === "NET" ? "Anlaşma net üzerinden" : "Brüt maaştan hesaplandı"}
        </p>
      </div>

      {detay && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs sm:col-span-2">
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Satir label="SGK işçi payı (%14)" value={detay.sgkEmployee} />
            <Satir label="İşsizlik sigortası (%1)" value={detay.unemploymentEmployee} />
            <Satir label="Gelir vergisi" value={detay.incomeTax} />
            <Satir label="Damga vergisi" value={detay.stampTax} />
            <Satir label="Asgari ücret istisnası" value={-detay.exemption} />
            <Satir label="İşverene maliyeti" value={detay.employerCost} strong />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {detay.paramYear} vergi parametreleriyle ve <strong>yıl başı</strong> (kümülatif
            matrah sıfır) varsayımıyla hesaplandı. Gelir vergisi yıl içinde biriken matrahla
            arttığı için aynı brütün neti sonraki aylarda düşer — buradaki rakam sözleşme
            değeridir, ayın kesin bordrosu değil.
          </p>
        </div>
      )}
    </>
  )
}

function Satir({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>
        {money(value)}
      </span>
    </div>
  )
}
