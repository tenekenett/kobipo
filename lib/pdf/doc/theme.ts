/**
 * Belge kiti — ortak ölçü ve renk belirteçleri.
 *
 * Neden tek yerde: eski jsPDF üreticilerinde her belge kendi mm sayılarını elle
 * taşıyordu (14, 18, 100, 196...) ve bir kolon genişliği değişince komşusu
 * kayıyordu. Burada ölçü TEK kaynak; bileşenler yüzde/esneme ile yerleşir.
 */

/** mm → pt (react-pdf varsayılan birimi pt). */
export const mm = (v: number) => +(v * (72 / 25.4)).toFixed(2)

export const PAGE = {
  size: "A4" as const,
  paddingTop: mm(12),
  paddingBottom: mm(18), // altlık burada oturur
  paddingHorizontal: mm(14),
}

export const COLORS = {
  text: "#1e1e1e",
  muted: "#6b7280",
  line: "#d1d5db",
  boxBg: "#f3f4f6",
  headBg: "#3b82f6",
  headText: "#ffffff",
  zebra: "#f9fafb",
  total: "#16a34a",
}

export const FS = {
  title: 18,
  h1: 13,
  h2: 10.5,
  body: 9,
  small: 8.5,
  tiny: 7.5,
}

export const FONT = "DejaVuSans"
