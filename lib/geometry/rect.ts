// Dikdörtgen jest matematiği — sürükle/boyutlandır yapan her tuval buradan beslenir.
//
// BİRİMSİZDİR: etiket tasarımcısı milimetre, salon planı ızgara hücresi geçirir.
// Ayrı dosyada durmasının sebebi kopya riskidir; iki tuval aynı tutamaç mantığını
// kendi içinde yazsaydı "batı tutamacı karşı kenarı sabit tutar" kuralı bir
// tarafta düzeltilip diğerinde unutulurdu.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

/**
 * Tutamaç sürüklemesini dikdörtgene uygular. `start` jest BAŞINDAKİ dikdörtgen,
 * `dx`/`dy` jest başından bu yana toplam fark (adım adım değil — birikimli fark
 * kullanmak yuvarlama hatasının sürükleme boyunca toplanmasını önler).
 *
 * Kenarlar `min`de durur ve karşı kenar sabit kalır: batıdan içeri çekince
 * dikdörtgen küçülür, doğu kenarı yerinde durur.
 */
export function applyResize(
  start: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  min = 1,
): Rect {
  let { x, y, w, h } = start

  if (handle.includes("e")) w = Math.max(min, start.w + dx)
  if (handle.includes("s")) h = Math.max(min, start.h + dy)
  if (handle.includes("w")) {
    const nextW = Math.max(min, start.w - dx)
    x = start.x + (start.w - nextW)
    w = nextW
  }
  if (handle.includes("n")) {
    const nextH = Math.max(min, start.h - dy)
    y = start.y + (start.h - nextH)
    h = nextH
  }

  return { x, y, w, h }
}

/** Handle'a uygun CSS cursor değeri. */
export function handleCursor(handle: ResizeHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize"
    case "e":
    case "w":
      return "ew-resize"
    case "ne":
    case "sw":
      return "nesw-resize"
    case "nw":
    case "se":
      return "nwse-resize"
  }
}

/** Tutamacın öğe kutusuna göre konumu (yüzde). Piksel boyu çağırana aittir. */
export function handleAnchor(handle: ResizeHandle): { left: string; top: string } {
  const left = handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%"
  const top = handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%"
  return { left, top }
}
