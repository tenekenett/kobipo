/**
 * Belge PDF uçlarının ortak yanıt yardımcıları. PDF'ler yeni sekmede, ucun KENDİ
 * adresinden açılır (lib/pdf/open-in-new-tab.ts): Chrome'un PDF görüntüleyicisi
 * "indir"de dosya adını yalnız gerçek adresin Content-Disposition'ından alır — blob
 * adresinde ad anlamsız çıkıyordu. Bu yüzden:
 *
 *   - `inlinePdfDisposition`: görüntülensin (attachment indirme penceresi açar) ve
 *     dosya adı faturanın numarası olsun.
 *   - `withNavigationErrorPage`: sekmede açılan isteğin hatası ham JSON yerine okunur
 *     bir sayfa olsun. fetch ile çağıran (e-posta eki, toplu ZIP) yine JSON alır.
 */

/** Belge numarasından dosya adı: GİB numarası / fatura no → `ADM2026000000018.pdf`. */
export function documentFileName(no: string | null | undefined, fallback: string, ext = "pdf"): string {
  const base = (no || "").trim() || fallback
  return `${base.replace(/[\\/:*?"<>|\s]+/g, "-")}.${ext}`
}

/** `inline` + ASCII yedekli UTF-8 dosya adı (RFC 6266 / 5987). */
export function inlineDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/**
 * Tarayıcı sekmesinde açılan (`Sec-Fetch-Dest: document`) isteğin JSON hatasını HTML
 * sayfasına çevirir; durum kodu korunur. Diğer istekler olduğu gibi geçer.
 */
export function withNavigationErrorPage<H extends (req: Request, ...rest: any[]) => Promise<Response>>(handler: H): H {
  return (async (req: Request, ...rest: any[]) => {
    const res = await handler(req, ...rest)
    if (res.ok || req.headers.get("sec-fetch-dest") !== "document") return res
    if (!(res.headers.get("content-type") || "").includes("application/json")) return res
    const data = await res.clone().json().catch(() => ({}) as any)
    const message =
      res.status === 401
        ? "Oturumunuz kapanmış. Kobipo'ya yeniden giriş yapıp tekrar deneyin."
        : typeof data?.error === "string" && data.error.trim()
          ? data.error
          : "Belge açılamadı."
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF açılamadı</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f5f6f8;color:#1f2937">
<div style="max-width:520px;margin:12vh auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px">
<h1 style="margin:0 0 8px;font-size:18px">PDF açılamadı</h1>
<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(message)}</p>
<p style="margin:0;color:#6b7280;font-size:14px">Bu sekmeyi kapatıp Kobipo'dan tekrar deneyebilirsiniz.</p>
</div></body></html>`
    return new Response(html, { status: res.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }) as H
}
