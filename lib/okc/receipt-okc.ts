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

// ── Fiş iptali ──────────────────────────────────────────────────────────────
//
// Kobipo'da iptal edilen fiş Z mutabakatının Kobipo tarafından düşer. Mali fiş
// yazarkasada da iptal edilmediyse Z ile Kobipo sessizce ayrışır. Bu yüzden:
//  - Fişi kapsayan Z raporu GİRİLMİŞSE iptal yok: Z kapanmış, cihazda iptal
//    artık mümkün değil; girilmiş Z'nin rakamı geriye dönük bozulmasın.
//  - Cihazdan gelen fiş (DEVICE) elle iptal edilmez; iptal cihazdan gelir (Aşama 2).
//  - Yazarkasa bilgisi girilmiş fiş, kullanıcı "yazarkasada da iptal ettim"
//    demeden iptal edilmez (`confirmed`).
// Yazarkasa bilgisi olmayan fiş yalnız ilk kurala tabidir (Z penceresi onu da sayar).

export type ReceiptCancelInput = {
  okcDeviceId: string | null
  okcReceiptNo: number | null
  okcZNo: number | null
  okcSource: string | null
  /** Fişi kapsayan Z raporu girilmiş mi (z-mutabakat penceresiyle aynı kural). */
  coveringZNo: number | null
  confirmed: boolean
}

export type ReceiptCancelVerdict =
  | { ok: true }
  | { ok: false; code: "OKC_Z_TAKEN" | "OKC_DEVICE" | "OKC_CONFIRM"; error: string }

export function receiptCancelVerdict(input: ReceiptCancelInput): ReceiptCancelVerdict {
  if (input.coveringZNo !== null) {
    return {
      ok: false,
      code: "OKC_Z_TAKEN",
      error:
        `Bu fiş Z ${input.coveringZNo} raporuna girdi; Z alındıktan sonra fiş iptal edilemez. ` +
        "Z raporu ya da fişin yazarkasa bilgisi yanlış girildiyse önce onu düzeltin.",
    }
  }
  if (input.okcSource === "DEVICE") {
    return {
      ok: false,
      code: "OKC_DEVICE",
      error: "Bu fiş yazarkasadan geldi; iptali yazarkasada yapılır ve Kobipo'ya oradan düşer.",
    }
  }
  if (input.okcDeviceId && !input.confirmed) {
    const no = input.okcReceiptNo !== null ? ` (ÖKC fiş no ${input.okcReceiptNo})` : ""
    return {
      ok: false,
      code: "OKC_CONFIRM",
      error: `Bu fiş yazarkasada basıldı${no}. Kobipo'da iptal etmeden önce yazarkasada da iptal edin.`,
    }
  }
  return { ok: true }
}
