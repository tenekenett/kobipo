"use client"

import { useCallback, useEffect, useState } from "react"

import { convertAmount, rateOf as rateOfPure } from "./convert"

export type FxRates = { USD: number; EUR: number; date: string }

/**
 * Güncel TCMB kurları (USD/EUR → TRY) + çevrim yardımcıları — istemci tarafı.
 *
 * `/api/kur` HATA DURUMUNDA DA 200 döner (`success:false`), bkz. app/api/kur/route.ts:
 * ekran kilitlenmesin, kullanıcı elle devam edebilsin diye bilinçli. Bu yüzden burada
 * `res.ok` yetmez, `success` bayrağına bakılır; kur yoksa `rates` null kalır ve
 * `convert()` null döner — çağıran "çeviremedim" hâlini kendi bağlamına göre ele alır
 * (teklifte çevirmeden ekle + uyar; tezgâhta fiyatı boş bırak).
 *
 * Kur ekran/dialog açılışında BİR KEZ çekilir, her satırda değil; TCMB verisi gün
 * içinde değişmiyor (sunucu tarafı da 2 saat cache'liyor).
 *
 * @param enabled false ise istek atılmaz — modal/dialog içeriğinde açılana dek beklemek için.
 */
export function useTcmbRates(enabled = true) {
  const [rates, setRates] = useState<FxRates | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    fetch("/api/kur")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.success) {
          setRates({ USD: Number(d.USD), EUR: Number(d.EUR), date: String(d.date || "") })
        }
      })
      .catch(() => {
        /* kur alınamadıysa sessiz geç; çeviri denenince çağıran uyarır */
      })
    return () => {
      alive = false
    }
  }, [enabled])

  /** X → TRY oranı; bilinmeyen para birimi veya kur yoksa 0. */
  const rateOf = useCallback((cur: string): number => rateOfPure(rates, cur), [rates])

  /** İki para birimi arası çeviri; kur bilinmiyorsa null (bkz. convert.ts). */
  const convert = useCallback(
    (value: number, from: string, to: string): number | null =>
      convertAmount(value, from, to, rates),
    [rates],
  )

  return { rates, rateOf, convert }
}
