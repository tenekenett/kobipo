"use client"

/**
 * Personel kartındaki "çalışma düzeni" seçimi — bu çalışan hangi takvimde?
 *
 * KARMA işletmenin tek gerçek kaynağı budur (`Employee.usesShifts`): vardiya
 * takvimi yalnız vardiyalıları, devam takvimi yalnız sabit mesailileri listeler
 * ve aylık özetler de aynı ayrımı uygular. Böylece bir çalışanın ayı HER ZAMAN
 * tek kaynaktan bordroya gider; iki takvimde birden görünseydi hem saat hem gün
 * hesaplanır, kesinti iki kez sayılırdı.
 *
 * Varsayılan "firmanın düzeni"dir ve etiketinde hangi tarafa düştüğü YAZILIDIR:
 * karma işletmede seçim yapılmamış personel vardiyalı sayılır ve bunu görmeden
 * kaydeden kullanıcı, çalışanı yanlış takvimde arar.
 */

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { defaultUsesShifts, normalizeMode } from "@/lib/personel/kip"

/** Formda saklanan değer: seçim yapılmadıysa boş dize (= firmanın düzeni). */
export type CalismaDuzeniDegeri = "" | "SHIFT" | "FLAT"

export const usesShiftsFromForm = (v: CalismaDuzeniDegeri): boolean | null =>
  v === "SHIFT" ? true : v === "FLAT" ? false : null

export const formFromUsesShifts = (v: boolean | null | undefined): CalismaDuzeniDegeri =>
  v === true ? "SHIFT" : v === false ? "FLAT" : ""

export function CalismaDuzeniSecici({
  value,
  companyMode,
  onChange,
}: {
  value: CalismaDuzeniDegeri
  /** `Company.workScheduleMode` — varsayılan etiketini yazmak için. */
  companyMode: string | null | undefined
  onChange: (next: CalismaDuzeniDegeri) => void
}) {
  const mode = normalizeMode(companyMode)
  const varsayilan = defaultUsesShifts(mode) ? "Vardiyalı" : "Sabit mesai"

  return (
    <div>
      <Label>Çalışma Düzeni</Label>
      {/* Radix Select boş dizeyi değer olarak kabul etmediği için "firma
          varsayılanı" ayrı bir anahtarla temsil edilir. */}
      <Select value={value === "" ? "DEFAULT" : value} onValueChange={(v) => onChange(v === "DEFAULT" ? "" : (v as CalismaDuzeniDegeri))}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="DEFAULT">Firma varsayılanı ({varsayilan})</SelectItem>
          <SelectItem value="SHIFT">Vardiyalı — vardiya takviminde</SelectItem>
          <SelectItem value="FLAT">Sabit mesai — devam takviminde</SelectItem>
        </SelectContent>
      </Select>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {mode === "MIXED"
          ? "Karma düzende bu seçim çalışanın hangi takvimde görüneceğini belirler."
          : `Firmanın düzeni: ${varsayilan}. Bu çalışan için istisna tanımlayabilirsiniz.`}
      </p>
    </div>
  )
}
