import { Resend } from "resend"

/**
 * Resend e-posta gönderim yardımcı katmanı.
 *
 * RESEND_API_KEY tanımlı değilse client kurulmaz; sendEmail() çağrıları
 * sessizce atlanıp loglanır (akışı bloklamaz). Böylece geliştirme/build
 * ortamında key olmadan da kod çalışır. E-posta gönderimi yan işlemdir;
 * çağıran taraf hataya göre 500 ATMAMALIDIR — ana işlem (atama, token
 * oluşturma) e-posta başarısız olsa bile tamamlanır.
 */

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

export const EMAIL_FROM =
  process.env.EMAIL_FROM || "Kobipo <no-reply@kobipo.com>"

/**
 * Gönderen adres no-reply@ olduğu için sistem e-postasına "yanıtla" diyen
 * kullanıcının yazdığı BOŞLUĞA gidiyordu: no-reply@ bir posta kutusu değil.
 * Her gönderim varsayılan olarak destek adresine yanıtlanır; çağıran taraf
 * `replyTo` vererek bunu ezebilir (ör. fatura e-postasında firmanın kendi
 * adresi). Adresin gerçekten bir kutuya düşmesi kobipo.com MX kaydına bağlıdır.
 */
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "destek@kobipo.com"

export type EmailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export type SendEmailParams = {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string | string[]
  /**
   * Gönderen GÖRÜNEN ADI (adres değişmez, EMAIL_FROM'unki kalır). Fatura e-postası
   * firmanın adıyla gider: müşterinin müşterisi "Kobipo"dan değil satıcısından fatura
   * beklediği için tanımadığı bir ad hem güveni hem teslim oranını düşürür.
   */
  fromName?: string
  /** Yalnız tekli gönderimde: Resend'in toplu ucu ek kabul etmez. */
  attachments?: EmailAttachment[]
}

/** EMAIL_FROM'un adresini koruyup görünen adı değiştirir: `"Ad" <adres>`. */
export function fromWithName(name: string | undefined, base: string = EMAIL_FROM): string {
  const cleaned = (name || "").replace(/["<>\\\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70)
  if (!cleaned) return base
  const match = base.match(/<([^>]+)>/)
  const address = match ? match[1] : base.trim()
  return `"${cleaned}" <${address}>`
}

export type SendEmailResult = {
  ok: boolean
  skipped?: boolean
  id?: string
  error?: string
}

/**
 * Çok alıcıya AYRI AYRI e-posta — tek HTTP çağrısında.
 *
 * `sendEmail`i döngüde çağırmak alıcı başına bir istek demek: otuz kişilik bir
 * ekibe vardiya planı gönderirken bu, sağlayıcı hız sınırına takılan ve sunucu
 * zaman aşımına düşebilen bir döngü üretiyordu. Resend'in toplu ucu yüz mesajı
 * tek çağrıda alır.
 *
 * Her mesaj KENDİ gövdesini taşır (herkes yalnız kendi planını görmeli), yani bu
 * "aynı e-postayı çok kişiye" değil "çok e-postayı tek çağrıda" göndermektir.
 * Yüzden fazlası varsa istek yüzerlik parçalara bölünür.
 */
export async function sendEmailBatch(
  messages: SendEmailParams[],
): Promise<{ sent: number; failed: number; skipped?: boolean }> {
  if (messages.length === 0) return { sent: 0, failed: 0 }
  if (!resend) {
    console.warn("[email] RESEND_API_KEY tanımlı değil — toplu gönderim atlandı.", {
      count: messages.length,
    })
    return { sent: 0, failed: 0, skipped: true }
  }

  const CHUNK = 100
  let sent = 0
  let failed = 0
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK)
    try {
      const { error } = await resend.batch.send(
        chunk.map((m) => ({
          from: fromWithName(m.fromName),
          to: m.to,
          subject: m.subject,
          html: m.html,
          replyTo: m.replyTo ?? EMAIL_REPLY_TO,
        })),
      )
      if (error) {
        console.error("[email] Resend toplu gönderim hatası:", error)
        failed += chunk.length
      } else {
        sent += chunk.length
      }
    } catch (err: any) {
      console.error("[email] Beklenmeyen toplu gönderim hatası:", err)
      failed += chunk.length
    }
  }
  return { sent, failed }
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  fromName,
  attachments,
}: SendEmailParams): Promise<SendEmailResult> {
  if (!resend) {
    console.warn(
      "[email] RESEND_API_KEY tanımlı değil — gönderim atlandı.",
      { to, subject }
    )
    return { ok: false, skipped: true }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromWithName(fromName),
      to,
      subject,
      html,
      replyTo: replyTo ?? EMAIL_REPLY_TO,
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    })

    if (error) {
      console.error("[email] Resend gönderim hatası:", error)
      return { ok: false, error: error.message }
    }

    return { ok: true, id: data?.id }
  } catch (err: any) {
    console.error("[email] Beklenmeyen gönderim hatası:", err)
    return { ok: false, error: err?.message ?? "unknown error" }
  }
}
