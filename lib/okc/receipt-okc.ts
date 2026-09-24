// Fişin ÖKC (yazarkasa) mali kimliği — elle giriş doğrulaması. Plan: ASAMA1-KOBIPO.md A3 (K2).
//
// Aşama 1'de her fişe ÖKC no girmek ZORUNLU DEĞİL (kasiyeri yavaşlatır); fiş
// detayında isteğe bağlı yazılır ve Z mutabakatında o fişi pencereden değil
// doğrudan Z no'dan eşler. Cihazdan gelen numara (okcSource = DEVICE) elle
// DEĞİŞTİRİLEMEZ: mali belgenin kimliği cihazın söylediğidir.

export type ReceiptOkcFields = {
  okcDeviceId: string | null
  okcReceiptNo: number | null
  okcZNo: number | null
}

export type ReceiptOkcResult = { ok: true; data: ReceiptOkcFields } | { ok: false; error: string }

function positiveIntOrNull(value: unknown, label: string): number | null | string {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return `${label} pozitif bir tam sayı olmalı`
  return n
}

/** Hepsi boş → kimlik temizlenir. Numara varsa cihaz zorunludur. */
export function normalizeReceiptOkcInput(body: Record<string, unknown>): ReceiptOkcResult {
  const receiptNo = positiveIntOrNull(body.receiptNo, "ÖKC fiş no")
  if (typeof receiptNo === "string") return { ok: false, error: receiptNo }
  const zNo = positiveIntOrNull(body.zNo, "Z no")
  if (typeof zNo === "string") return { ok: false, error: zNo }
  const deviceId = String(body.deviceId ?? "").trim() || null

  if (!deviceId && (receiptNo !== null || zNo !== null)) {
    return { ok: false, error: "ÖKC numarası girildiyse yazarkasa seçilmeli" }
  }
  return { ok: true, data: { okcDeviceId: deviceId, okcReceiptNo: receiptNo, okcZNo: zNo } }
}
