/** Para/sayı biçimleme — belge kiti genelinde tek kaynak. */

export const currencySymbol = (code: string) =>
  ({ TRY: "₺", USD: "$", EUR: "€" } as Record<string, string>)[code] || `${code} `

export const fmtNumber = (n: unknown) =>
  (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtMoney = (n: unknown, currency: string) => `${currencySymbol(currency)}${fmtNumber(n)}`

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("tr-TR") : "—"
