import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Content-Disposition başlığındaki dosya adını ayıklar.
 * `filename*=UTF-8''...` (RFC 5987) ve düz `filename="..."` formatlarını destekler.
 * Bulamazsa null döner.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const extended = header.match(/filename\*=(?:UTF-8'')?["']?([^"';]+)["']?/i)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1])
    } catch {
      return extended[1]
    }
  }
  const basic = header.match(/filename=["']?([^"';]+)["']?/i)
  return basic?.[1]?.trim() || null
}

