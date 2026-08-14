import { prisma } from "@/lib/db/prisma"

/**
 * Havale referans kodu — müşterinin banka açıklamasına yazdığı kod.
 *
 * NEDEN VAR: sipariş id'si cuid (25 karakter, küçük/büyük harf karışık) — banka
 * açıklamasına yazdırılamaz, telefonda okunamaz. Kod dekont ile hesap hareketini
 * eşleştiren tek alan olduğu için KARIŞAN KARAKTER içermez: 0/O ve 1/I/L elenmiştir.
 */

// I, L, O, U ve 0/1 yok: hem karışma hem de istenmeyen kelime türeme riskini keser.
const ALPHABET = "ABCDEFGHJKMNPRSTVYZ23456789"
const CODE_LENGTH = 6

export function generatePaymentCode(): string {
  let out = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return `KBP-${out}`
}

/**
 * Veritabanında kullanılmayan bir kod üretir. 27^6 ≈ 387 milyon kombinasyon var,
 * çakışma pratikte imkânsız; yine de kolon UNIQUE olduğu için birkaç kez denenir.
 */
export async function generateUniquePaymentCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePaymentCode()
    const existing = await prisma.kontorOrder.findUnique({
      where: { paymentCode: code },
      select: { id: true },
    })
    if (!existing) return code
  }
  // Buraya düşmek için 5 ardışık çakışma gerekir — kodu uzatarak garantiye al.
  return `${generatePaymentCode()}${Math.floor(Math.random() * 100)}`
}
