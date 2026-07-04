// SWR için ortak JSON fetcher. Yanıt OK değilse hata fırlatır ki SWR'ın
// `error` durumu doğru çalışsın; sunucunun döndürdüğü `error` mesajını taşır.
export class FetchError extends Error {
  status: number
  info: unknown
  constructor(message: string, status: number, info?: unknown) {
    super(message)
    this.name = "FetchError"
    this.status = status
    this.info = info
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
    throw new FetchError(serverMsg || `İstek başarısız (${res.status})`, res.status, info)
  }
  return res.json() as Promise<T>
}
