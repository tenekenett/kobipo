"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bold, Italic, List, ListOrdered, Underline, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BELGE_ALANLARI, sablonAlanlari } from "@/lib/personel/belge-alanlari"
import { govdeDuzMetin, govdeTemizle } from "@/lib/personel/belge-govde"

/**
 * İK belge şablonu editörü — sistem yönetim paneli ve firma ekranı AYNI bileşeni
 * kullanır.
 *
 * Tek bileşen olması şart: iki ayrı editör yazılsaydı Kobipo'nun kataloğa yazdığı
 * biçim ile kullanıcının kendi şablonunda ürettiği biçim zamanla ayrışır, aynı
 * gövde iki farklı şekilde basılırdı.
 *
 * Biçimlendirme İZİN LİSTESİYLE SINIRLI: kalın, italik, altı çizili, iki liste
 * türü. Araç çubuğu `document.execCommand` kullanır — eskimiş bir API olsa da
 * ürettiği işaretleme tam olarak `belge-govde.ts`in tanıdığı kümedir ve gövde
 * kaydedilirken zaten oradan geçiriliyor; fazlası sessizce düşer.
 */

export type SablonFormDegeri = {
  title: string
  category: string | null
  description: string | null
  body: string
  sortOrder: number
  isActive: boolean
}

const KATEGORILER = ["İzin", "Talep", "Sözleşme", "Fesih", "Belge", "Tutanak", "Diğer"]

export function BelgeSablonEditoru({
  deger,
  onChange,
  /** Katalog ekranında sıra ve kategori gösterilir; firma ekranında sıra gereksiz. */
  sirayiGoster = true,
}: {
  deger: SablonFormDegeri
  onChange: (d: SablonFormDegeri) => void
  sirayiGoster?: boolean
}) {
  const govdeRef = useRef<HTMLDivElement | null>(null)
  const sonAralik = useRef<Range | null>(null)
  const [odakli, setOdakli] = useState(false)

  // Gövde DIŞARIDAN yalnız bir kez yüklenir. Her render'da innerHTML yazmak,
  // kullanıcı yazarken imleci metnin başına atardı.
  useEffect(() => {
    const el = govdeRef.current
    if (!el) return
    if (el.innerHTML !== deger.body && !odakli) el.innerHTML = deger.body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deger.body])

  const govdeDegisti = useCallback(() => {
    const el = govdeRef.current
    if (el) onChange({ ...deger, body: el.innerHTML })
  }, [deger, onChange])

  const komut = (ad: string) => {
    govdeRef.current?.focus()
    document.execCommand(ad)
    govdeDegisti()
  }

  /**
   * İmlecin bulunduğu yere alan adı ekler.
   *
   * Düğme `onMouseDown`'da odağı ENGELLER (aşağıdaki `alanDugmesi`), yoksa tıklama
   * odağı editörden alır; sonraki `focus()` imleci metnin BAŞINA koyar ve alan
   * belgenin en üstüne eklenirdi — ölçüldü. `son aralık` ikinci kemer: odak yine de
   * kaçarsa (klavyeyle gezinme) son bilinen imleç konumuna geri konur.
   */
  const alanEkle = (ad: string) => {
    const el = govdeRef.current
    if (!el) return
    const secim = window.getSelection()
    const icerideMi = secim?.rangeCount && el.contains(secim.getRangeAt(0).commonAncestorContainer)
    if (!icerideMi && sonAralik.current) {
      el.focus()
      secim?.removeAllRanges()
      secim?.addRange(sonAralik.current)
    } else {
      el.focus()
    }
    // insertText: yapıştırılan metin düz kalır, tarayıcı fazladan etiket üretmez.
    document.execCommand("insertText", false, `{${ad}}`)
    govdeDegisti()
  }

  /** Editördeki son imleç konumu — odak kaçarsa geri konmak için. */
  const aralikHatirla = () => {
    const el = govdeRef.current
    const secim = window.getSelection()
    if (!el || !secim?.rangeCount) return
    const aralik = secim.getRangeAt(0)
    if (el.contains(aralik.commonAncestorContainer)) sonAralik.current = aralik.cloneRange()
  }

  // Alan listesi gövdeden CANLI türer — kullanıcı yazarken hangi alanların
  // kayıttan dolacağını, hangilerinin elle sorulacağını görür.
  const alanlar = useMemo(() => sablonAlanlari(deger.body || ""), [deger.body])
  const otomatik = alanlar.filter((a) => a.kaynak !== "ELLE")
  const elle = alanlar.filter((a) => a.kaynak === "ELLE")
  const bosMu = !govdeDuzMetin(deger.body || "")

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sablon-baslik">Şablon adı *</Label>
            <Input
              id="sablon-baslik"
              value={deger.title}
              onChange={(e) => onChange({ ...deger, title: e.target.value })}
              placeholder="Örn. Yıllık İzin Talep Formu"
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sablon-kategori">Kategori</Label>
            <Select
              value={deger.category ?? "yok"}
              onValueChange={(v) => onChange({ ...deger, category: v === "yok" ? null : v })}
            >
              <SelectTrigger id="sablon-kategori">
                <SelectValue placeholder="Seçiniz" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yok">Kategorisiz</SelectItem>
                {KATEGORILER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sablon-aciklama">Açıklama</Label>
          <Input
            id="sablon-aciklama"
            value={deger.description ?? ""}
            onChange={(e) => onChange({ ...deger, description: e.target.value || null })}
            placeholder="Bu şablon ne zaman kullanılır?"
            maxLength={300}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 bg-muted/40 p-1">
            <ToolbarDugmesi ikon={Bold} etiket="Kalın" onClick={() => komut("bold")} />
            <ToolbarDugmesi ikon={Italic} etiket="İtalik" onClick={() => komut("italic")} />
            <ToolbarDugmesi ikon={Underline} etiket="Altı çizili" onClick={() => komut("underline")} />
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolbarDugmesi
              ikon={List}
              etiket="Madde listesi"
              onClick={() => komut("insertUnorderedList")}
            />
            <ToolbarDugmesi
              ikon={ListOrdered}
              etiket="Numaralı liste"
              onClick={() => komut("insertOrderedList")}
            />
          </div>
          <div
            ref={govdeRef}
            role="textbox"
            aria-multiline="true"
            aria-label="Şablon metni"
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              govdeDegisti()
              aralikHatirla()
            }}
            onKeyUp={aralikHatirla}
            onMouseUp={aralikHatirla}
            onFocus={() => setOdakli(true)}
            onBlur={() => {
              setOdakli(false)
              // Odak kaybında bir kez temizle: kullanıcı başka bir yerden metin
              // yapıştırdıysa (Word, web sayfası) izinsiz etiketler burada düşer ve
              // kullanıcı sonucu HEMEN görür — kaydettikten sonra değil.
              const el = govdeRef.current
              if (!el) return
              const temiz = govdeTemizle(el.innerHTML)
              if (temiz !== el.innerHTML) {
                el.innerHTML = temiz
                onChange({ ...deger, body: temiz })
              }
            }}
            className="min-h-[320px] rounded-b-md border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
          />
          <p className="text-xs text-muted-foreground">
            Doldurulacak yerleri süslü parantez içine yazın:{" "}
            <code className="rounded bg-muted px-1">{"{Fesih Tarihi}"}</code>. Sağdaki listeden
            tıklayarak da ekleyebilirsiniz.
          </p>
          {bosMu && (
            <p className="text-xs text-destructive">Şablon metni boş olamaz.</p>
          )}
        </div>

        {sirayiGoster && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sablon-sira">Sıra</Label>
              <Input
                id="sablon-sira"
                type="number"
                value={String(deger.sortOrder)}
                onChange={(e) => onChange({ ...deger, sortOrder: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input
                id="sablon-aktif"
                type="checkbox"
                className="h-4 w-4"
                checked={deger.isActive}
                onChange={(e) => onChange({ ...deger, isActive: e.target.checked })}
              />
              <Label htmlFor="sablon-aktif" className="cursor-pointer">
                Aktif (listede görünsün)
              </Label>
            </div>
          </div>
        )}
      </div>

      {/* ---- Alan paneli ---- */}
      <div className="space-y-4 lg:border-l lg:pl-4">
        <div>
          <p className="text-sm font-medium">Bu şablondaki alanlar</p>
          {alanlar.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Henüz alan yok. Metne <code>{"{...}"}</code> yazın.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {otomatik.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Kayıttan dolacak ({otomatik.length})
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {otomatik.map((a) => (
                      <li key={a.ad} className="text-xs text-muted-foreground">
                        {a.ad}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {elle.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Belge basılırken sorulacak ({elle.length})
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {elle.map((a) => (
                      <li key={a.ad} className="text-xs text-muted-foreground">
                        {a.ad}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium">Hazır alanlar</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tıklayın, metne eklensin. Bunlar firma ve personel kartından otomatik dolar.
          </p>
          <div className="mt-2 max-h-[300px] space-y-0.5 overflow-y-auto pr-1">
            {BELGE_ALANLARI.map((a) => (
              <button
                key={a.ad}
                type="button"
                // Araç çubuğu düğmeleriyle aynı sebep: odak editörde kalmalı.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => alanEkle(a.ad)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                title={a.aciklama}
              >
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.ad}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolbarDugmesi({
  ikon: Ikon,
  etiket,
  onClick,
}: {
  ikon: typeof Bold
  etiket: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      title={etiket}
      aria-label={etiket}
      // onMouseDown + preventDefault: tıklama odağı editörden ALMASIN, yoksa
      // seçim kaybolur ve biçim komutu boşa gider.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Ikon className="h-3.5 w-3.5" />
    </Button>
  )
}
