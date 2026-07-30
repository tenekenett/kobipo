// SWR için ortak JSON fetcher. Yanıt OK değilse hata fırlatır ki SWR'ın
// `error` durumu doğru çalışsın; sunucunun döndürdüğü `error` mesajını taşır.
export class FetchError extends Error {
  status: number
  info: unknown
  /**
   * Sunucunun kendi açıkladığı sebep (gövdedeki `error` alanı) — yoksa null.
   * `message`'dan AYRI tutuluyor: `message` her zaman doludur (gerekirse
   * "İstek başarısız (500)" gibi bir yer tutucu), o yüzden ondan "sunucu bir
   * şey söyledi mi?" sorusunun cevabı çıkarılamaz.
   */
  serverMessage: string | null
  constructor(message: string, status: number, info?: unknown, serverMessage?: string | null) {
    super(message)
    this.name = "FetchError"
    this.status = status
    this.info = info
    this.serverMessage = serverMessage ?? null
  }
}

export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    let info: unknown
    try {
      info = await res.json()
    } catch {
      /* yanıt gövdesi JSON değil */
    }
    const serverMsg =
      info && typeof info === "object" && "error" in info && typeof (info as { error?: unknown }).error === "string"
        ? (info as { error: string }).error
        : null
    throw new FetchError(serverMsg || `İstek başarısız (${res.status})`, res.status, info, serverMsg)
  }
  return res.json() as Promise<T>
}

/** Sunucunun "hiçbir şey söylememiş" sayılacak jenerik yanıtları. */
const OPAQUE_SERVER_MESSAGES = new Set(["internal server error", "internal error", "error"])

export type FetchFailure = {
  /** Kullanıcıya gösterilecek ana cümle. */
  message: string
  /** Sunucunun söylediği ek sebep — teşhisi kısaltır; jenerikse null. */
  detail: string | null
  /** Suçlu taraf: ekran ikon/renk/aksiyon seçmek isterse kullanır. */
  kind: "network" | "auth" | "server" | "request"
}

/**
 * SWR hatasını kullanıcıya anlamlı tek cümleye çevirir.
 *
 * Ayrım ZORUNLU: 500 ile ağ kopukluğunu aynı "bağlantınızı kontrol edin"
 * mesajının arkasına koymak kullanıcıyı modemini yeniden başlatmaya gönderir —
 * oysa istek sunucuya ULAŞMIŞ, hata orada. Ayırt edici işaret `status`: bir
 * HTTP durumu varsa sunucu cevap vermiş demektir, ağ suçlanamaz. `fetch` ağ
 * seviyesinde reddedildiğinde (offline, DNS, sunucu kapalı) `FetchError` hiç
 * oluşmaz, elimize `TypeError` gelir — status da yoktur.
 *
 * @param subject Ekranın çekmeye çalıştığı şeyin adı, ör. "Masalar".
 */
export function describeFetchError(error: unknown, subject: string): FetchFailure {
  const status = error instanceof FetchError ? error.status : null
  const raw = error instanceof FetchError ? error.serverMessage : null
  const detail = raw && !OPAQUE_SERVER_MESSAGES.has(raw.trim().toLowerCase()) ? raw : null

  if (status == null) {
    // `navigator.onLine === false` KESİN çevrimdışıdır; true olması ise bağlantı
    // garantisi değil (kablo var, internet yok) — o yüzden true durumunda daha
    // temkinli "sunucuya ulaşılamadı" diyoruz.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false
    return {
      kind: "network",
      message: offline
        ? `${subject} yüklenemedi: cihaz çevrimdışı. Bağlantınızı kontrol edip sayfayı yenileyin.`
        : `${subject} yüklenemedi: sunucuya ulaşılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.`,
      detail: null,
    }
  }

  if (status === 401) {
    return {
      kind: "auth",
      message: "Oturumunuz sona ermiş. Yeniden giriş yapıp tekrar deneyin.",
      detail: null,
    }
  }

  if (status === 403) {
    // Yetki hatalarında sunucunun cümlesi ("Restoran & Kafe modülü kapalı" gibi)
    // asıl bilgidir; "Access denied:" öneki kullanıcıya bir şey söylemez.
    const reason = detail?.replace(/^access denied:?\s*/i, "") || null
    return {
      kind: "auth",
      message: reason ? `${subject} görüntülenemiyor: ${reason}` : `${subject} için yetkiniz yok.`,
      detail: null,
    }
  }

  if (status >= 500) {
    return {
      kind: "server",
      message: `${subject} yüklenemedi: sunucu hatası (${status}). Bu bir bağlantı sorunu değil — sayfayı yenileyin, sürerse destekle iletişime geçin.`,
      detail,
    }
  }

  return {
    kind: "request",
    message: detail
      ? `${subject} yüklenemedi: ${detail}`
      : `${subject} yüklenemedi: istek reddedildi (${status}).`,
    detail: null,
  }
}
