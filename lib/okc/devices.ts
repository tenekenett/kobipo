// Yazarkasa (ÖKC) cihaz tanımı — SAF doğrulama. Plan: docs/okc/ASAMA1-KOBIPO.md A2.
//
// Cihaz ŞUBE bazlıdır (Company = şube). Aşama 1'de bağlantı yoktur (provider
// MANUAL); cihaz yalnız Z raporunun ve fişin mali kimliğinin sahibi olarak durur.

/** Seçicide önerilen markalar. Serbest metin de kabul edilir ("Diğer"). */
export const OKC_BRANDS = [
  "Beko",
  "Hugin",
  "Ingenico",
  "PAX",
  "Pavo",
  "Ödeal",
  "inPOS",
  "Verifone",
  "Profilo",
] as const

/** Cihaza nasıl bağlanılıyor. Aşama 1'de yalnız MANUAL yazılır. */
export const OKC_PROVIDERS = ["MANUAL", "TOKEN", "PAVO", "ODEAL"] as const
export type OkcProvider = (typeof OKC_PROVIDERS)[number]

export const OKC_PROVIDER_LABELS: Record<OkcProvider, string> = {
  MANUAL: "Bağlantı yok",
  TOKEN: "Token (bulut)",
  PAVO: "Pavo (bulut)",
  ODEAL: "Ödeal (bulut)",
}

export type OkcDeviceFields = {
  name: string
  brand: string | null
  model: string | null
  serialNo: string
  ekuNo: string | null
}

export type OkcDeviceView = OkcDeviceFields & {
  id: string
  provider: string
  mode: string | null
  isActive: boolean
  /** Z kaydı varsa cihaz silinemez, pasife alınır. */
  zReportCount: number
  lastZ: { zNo: number; takenAt: string } | null
}

const LIMITS = { name: 60, brand: 40, model: 60, serialNo: 40, ekuNo: 40 } as const

/**
 * Seri / EKÜ no: boşlukları atar, BÜYÜK harfe çevirir. Cihaz etiketinde
 * "JH 2001 2345" yazar, Z fişinde "JH20012345" — ikisi aynı cihazdır; kıyas
 * normalize edilmiş değer üzerinden yapılmazsa aynı cihaz iki kez tanımlanır.
 */
export function normalizeDeviceCode(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLocaleUpperCase("tr-TR")
}

function optionalText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim()
  return text ? text.slice(0, max) : null
}

export type DeviceInputResult =
  | { ok: true; data: Partial<OkcDeviceFields> }
  | { ok: false; error: string }

/**
 * Gövdeyi doğrular. `partial` (PATCH) kipinde yalnız GELEN alanlar döner;
 * gelmeyen alana dokunulmaz. Oluştururken ad ve seri no zorunludur.
 */
export function normalizeDeviceInput(
  body: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): DeviceInputResult {
  const data: Partial<OkcDeviceFields> = {}

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim()
    if (!name) return { ok: false, error: "Cihaz adı zorunlu (ör. Kasa 1)" }
    if (name.length > LIMITS.name) return { ok: false, error: `Cihaz adı en fazla ${LIMITS.name} karakter` }
    data.name = name
  }

  if (!partial || body.serialNo !== undefined) {
    const serialNo = normalizeDeviceCode(body.serialNo)
    if (!serialNo) return { ok: false, error: "Cihaz seri (mali sicil) numarası zorunlu" }
    if (serialNo.length > LIMITS.serialNo) {
      return { ok: false, error: `Seri numarası en fazla ${LIMITS.serialNo} karakter` }
    }
    if (!/^[0-9A-ZÇĞİÖŞÜ\-./]+$/.test(serialNo)) {
      return { ok: false, error: "Seri numarası yalnız harf, rakam ve - . / içerebilir" }
    }
    data.serialNo = serialNo
  }

  if (!partial || body.ekuNo !== undefined) {
    const ekuNo = normalizeDeviceCode(body.ekuNo)
    if (ekuNo.length > LIMITS.ekuNo) return { ok: false, error: `EKÜ numarası en fazla ${LIMITS.ekuNo} karakter` }
    data.ekuNo = ekuNo || null
  }

  if (!partial || body.brand !== undefined) data.brand = optionalText(body.brand, LIMITS.brand)
  if (!partial || body.model !== undefined) data.model = optionalText(body.model, LIMITS.model)

  return { ok: true, data }
}
