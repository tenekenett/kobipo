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

export type SendEmailParams = {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string | string[]
}

export type SendEmailResult = {
  ok: boolean
  skipped?: boolean
  id?: string
  error?: string
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
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
      from: EMAIL_FROM,
      to,
      subject,
      html,
      replyTo,
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
