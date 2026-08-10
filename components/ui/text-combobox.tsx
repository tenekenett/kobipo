"use client"

// Serbest metin + öneri listesi.
//
// Native <datalist> yerine var: datalist listeyi yalnızca kullanıcı YAZMAYA
// başlayınca (ve tarayıcıya göre değişen kurallarla) açıyor, alanda hiçbir
// görsel ipucu bırakmıyor. Sonuç: mevcut kategorileri olan bir alan "hiç
// kategori yokmuş" gibi görünüyordu. Burada liste odaklanınca açılıyor ve
// sağdaki ok tıklanabilir bir affordans veriyor.
//
// Değer DAİMA serbest metindir — listede olmayan bir şey yazmak geçerli
// (kategori bir FK değil, etikettir).

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Türkçe karakterleri sadeleştirerek arama anahtarı üretir. */
function norm(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim()
}

export function TextCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  emptyText = "Kayıtlı seçenek yok — yazarak yenisini ekleyebilirsiniz",
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Öneriler; sırayla gösterilir (çağıran sıralar ve tekilleştirir). */
  options: string[]
  placeholder?: string
  disabled?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = norm(value)
    if (!q) return options
    return options.filter((o) => norm(o).includes(q))
  }, [options, value])

  // Yazılan metin listedeki TEK eşleşmenin aynısıysa liste bilgi taşımıyor demektir.
  const showList = open && !(matches.length === 1 && norm(matches[0]) === norm(value))

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function select(next: string) {
    onChange(next)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        className="pr-9"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            setOpen(true)
            return
          }
          if (!showList) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault()
            select(matches[highlight])
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />
      {/* Alanın açılır liste taşıdığını gösteren tek ipucu. */}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Seçenekleri göster"
        onMouseDown={(e) => {
          e.preventDefault()
          setOpen((o) => !o)
        }}
        className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground disabled:opacity-50"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", showList && "rotate-180")} />
      </button>

      {showList && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</li>
          ) : (
            matches.map((o, i) => (
              <li key={o}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(o)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                    i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                  )}
                >
                  {o}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
