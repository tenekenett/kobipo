// Etiket Tasarımcısı — emoji rasterizasyonu (yalnızca client; canvas kullanır).
// jsPDF + DejaVu emoji glifi çizemez; bu yüzden emoji ekleme ANINDA tarayıcının
// kendi emoji fontuyla canvas'a çizilip PNG data-URL'e çevrilir ve tasarımda
// "image" öğesi olarak saklanır. Böylece PDF tarafı sıradan görsel çizer.

export function rasterizeEmoji(char: string, px = 128): string | null {
  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.clearRect(0, 0, px, px)
  ctx.font = `${Math.floor(px * 0.8)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  // Emoji glifleri dikeyde hafif yukarı oturur; küçük bir düzeltme uygula.
  ctx.fillText(char, px / 2, px / 2 + px * 0.04)
  try {
    return canvas.toDataURL("image/png")
  } catch {
    return null
  }
}

// Toolbox'taki emoji ızgarası — perakende etikette işe yarayacak seçki.
export const EMOJI_CHOICES: string[] = [
  "⭐", "🌟", "✨", "🔥", "💥", "⚡", "🎉", "🎊", "🎁", "🎀",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✅",
  "☑️", "✔️", "❗", "❕", "‼️", "🆕", "🆓", "🏷️", "💰", "💸",
  "🛒", "🛍️", "📦", "🚚", "⏰", "📅", "📌", "📍", "🔖", "🎯",
  "🍎", "🍊", "🍋", "🍇", "🍓", "🥝", "🥕", "🌽", "🧀", "🥛",
  "🍞", "🥐", "🍰", "🍪", "☕", "🍵", "🧃", "🥤", "🍬", "🍫",
]
