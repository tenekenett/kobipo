"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

/**
 * Fatura kategorisi seçici.
 *
 * Kategoriler ayrı bir tabloda tutulmaz (ürün kategorisiyle aynı desen: serbest
 * metin). Ama serbest metin tek başına bırakılınca aynı kategori "Akaryakıt" /
 * "akaryakit" / "Akaryakit" diye üçe bölünüyor ve rapor kırılımı bozuluyor.
 * Bu yüzden:
 *   - 2 harften sonra ÖNCEKİ kategorilerden eşleşenler listelenir,
 *   - listede yoksa "yeni kategori oluştur" seçeneği çıkar (yine serbest metin,
 *     ama kullanıcı önce mevcutları görmüş olur),
 *   - klavyeyle gezinilebilir (yukarı/aşağı/Enter/Esc).
 *
 * NOT: Bu bileşen sabit `id` KULLANMAZ — fatura editörünün formu DOM'a iki kez
 * basıldığı için sabit id çift kayıt oluşturuyor ve etiket/odak yanlış kopyaya
 * gidiyordu.
 */

const MIN_QUERY = 2

export function CategoryCombobox({
  value,
  options,
  onChange,
  onCreateOption,
  placeholder = "Örn. Akaryakıt, Kira, Danışmanlık",
  disabled,
}: {
  value: string
  options: string[]
  onChange: (next: string) => void
  /** Yeni kategori oluşturulduğunda çağrılır — üst bileşen öneri listesine ekler. */
  onCreateOption?: (next: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // -1 = hiçbir satır seçili değil. Alan SERBEST METİN olduğu için varsayılan
  // davranış "yazdığını kabul et" olmalı; 0'dan başlayınca Enter her zaman ilk
  // MEVCUT eşleşmeyi seçiyordu ve yeni kategori yazmak klavyeyle mümkün olmuyordu.
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const query = value.trim()
  const norm = (v: string) => v.trim().toLocaleLowerCase("tr")

  const matches = useMemo(() => {
    if (query.length < MIN_QUERY) return []
    const q = norm(query)
    return options.filter((o) => norm(o).includes(q)).slice(0, 8)
  }, [options, query])

  // Yazılan değer mevcut bir kategoriyle birebir aynıysa "oluştur" satırı gereksiz.
  const exactExists = options.some((o) => norm(o) === norm(query))
  const canCreate = query.length >= MIN_QUERY && !exactExists

  // NOT: liste satırlarında onMouseEnter ile highlighted DEĞİŞTİRİLMEZ. Değiştirilseydi
  // listeye şöyle bir bakıp Enter'a basmak, yazılan yeni kategori yerine farenin denk
  // geldiği satırı seçerdi. Vurgu görsel olarak CSS hover ile veriliyor.
  const items: Array<{ kind: "existing" | "create"; value: string }> = [
    ...matches.map((m) => ({ kind: "existing" as const, value: m })),
    ...(canCreate ? [{ kind: "create" as const, value: query }] : []),
  ]

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])

  useEffect(() => setHighlighted(-1), [value])

  const pick = (v: string, isNew = false) => {
    onChange(v)
    // Yeni kategori anında öneri listesine girsin; yoksa alana tekrar odaklanınca
    // "+ ... oluştur" satırı yine çıkıyor ve kategori hiç oluşmamış gibi görünüyordu.
    if (isNew) onCreateOption?.(v)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) {
            if (e.key === "ArrowDown") setOpen(true)
            return
          }
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlighted((h) => (h + 1 >= items.length ? 0 : h + 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlighted((h) => (h <= 0 ? items.length - 1 : h - 1))
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (highlighted >= 0 && items[highlighted]) {
              const it = items[highlighted]
              pick(it.value, it.kind === "create")
            } else {
              // Ok tuşlarıyla bir satıra inilmediyse: yazılan metni olduğu gibi kabul et.
              if (canCreate) onCreateOption?.(query)
              setOpen(false)
            }
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />

      {open && items.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {items.map((item, i) => (
            <button
              key={`${item.kind}:${item.value}`}
              type="button"
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                highlighted === i ? "bg-accent text-accent-foreground" : ""
              } ${item.kind === "create" ? "border-t font-medium text-primary" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item.value, item.kind === "create")}
            >
              {item.kind === "create" ? (
                <span>+ &quot;{item.value}&quot; kategorisini oluştur</span>
              ) : (
                <span>{item.value}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Alan serbest metin olduğu için "oluştur"a tıklamak görünürde hiçbir şey
          değiştirmiyordu (değer zaten yazılan metin). Durumu açıkça yazıyoruz. */}
      {query.length > 0 && query.length < MIN_QUERY && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Öneriler için en az {MIN_QUERY} harf yazın.
        </p>
      )}
      {query.length >= MIN_QUERY && (
        <p className="mt-1 text-[11px]">
          {exactExists ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              Mevcut kategori: {query}
            </span>
          ) : (
            <span className="text-muted-foreground">
              &quot;{query}&quot; yeni kategori olarak kaydedilecek.
            </span>
          )}
        </p>
      )}
    </div>
  )
}
