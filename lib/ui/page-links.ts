// Sayfalama çubuğunda hangi sayfa numaralarının çizileceği.
//
// Yalnız Önceki/Sonraki olan çubukta 15. sayfaya gitmek 14 tıklama istiyordu.
// Kural, alışılmış "pencere + sıçrama" düzeni: geçerli sayfanın çevresinde
// 10'luk bir pencere, pencerenin iki yanında 10'un katlarıyla en çok 4'er
// sıçrama (20 30 40 50), ayrıca her zaman ilk ve son sayfa. 1. sayfada
// `1 … 10 20 30 40 50 son` çıkar; 37. sayfada `1 10 20 30 33 … 42 50 60 70 80 son`.
//
// Saf fonksiyon: bileşen çizmez, yalnız sıralı ve tekrarsız numara listesi döner.

export function pageLinks(
  page: number,
  pageCount: number,
  opts?: { window?: number; jumps?: number },
): number[] {
  const window = Math.max(1, opts?.window ?? 10)
  const jumps = Math.max(0, opts?.jumps ?? 4)
  const count = Math.max(1, Math.floor(pageCount))
  const current = Math.min(Math.max(1, Math.floor(page)), count)

  if (count <= window) return Array.from({ length: count }, (_, i) => i + 1)

  // Pencere: geçerli sayfa ortaya yakın dursun, sınırda kayıp genişliğini korusun.
  let start = Math.max(1, current - Math.floor((window - 1) / 2))
  let end = start + window - 1
  if (end > count) {
    end = count
    start = end - window + 1
  }

  const set = new Set<number>([1, count])
  for (let n = start; n <= end; n++) set.add(n)

  // İleri sıçramalar: pencereden sonraki ilk 10 katından başlar.
  for (let n = Math.ceil((end + 1) / 10) * 10, k = 0; n <= count && k < jumps; n += 10, k++) set.add(n)
  // Geri sıçramalar: pencereden önceki son 10 katından başlar.
  for (let n = Math.floor((start - 1) / 10) * 10, k = 0; n >= 1 && k < jumps; n -= 10, k++) set.add(n)

  return Array.from(set).sort((a, b) => a - b)
}
