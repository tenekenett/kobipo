/**
 * Resend ile gönderilen işlemsel e-postaların HTML şablonları.
 * E-posta istemcileri modern CSS'i desteklemediğinden tüm stiller inline'dır
 * ve tablo tabanlı yerleşim yerine basit, dayanıklı bir kart kullanılır.
 */

const NAVY = "#0C3B6B"
const BLUE = "#185FA5"
const MID = "#378ADD"
const TEXT = "#1f2a37"
const GRAY = "#6b7280"
const BORDER = "#e5e7eb"
const GREEN = "#2D6A4F"

// Marka kilidi e-postada HTML metni olarak kurulur: SVG/yeni görseller e-posta
// istemcilerinde (özellikle Gmail) güvenilir render olmaz; metin daima görünür
// ve "kobi"/"po" arasında boşluk bırakmaz. Renk/ağırlıklar logo SVG'siyle aynı.
function brandLockup(): string {
  return `<div style="text-align:center;margin-bottom:26px;">
    <div style="font-size:30px;line-height:1;letter-spacing:-1px;">
      <span style="font-weight:800;color:${NAVY};">kobi</span><span style="font-weight:400;color:${BLUE};">po</span>
    </div>
    <div style="font-size:11px;font-weight:700;font-style:italic;color:${GREEN};letter-spacing:0.2px;margin-top:5px;">Az laf, doğru rakam.</div>
  </div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

type LayoutOptions = {
  title: string
  /** Hazır (escape edilmiş / güvenilir) HTML gövde. */
  bodyHtml: string
}

function layout({ title, bodyHtml }: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'DM Sans',Segoe UI,Helvetica,Arial,sans-serif;color:${TEXT};">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid ${BORDER};border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(12,59,107,0.06);">
        ${brandLockup()}
        ${bodyHtml}
      </div>
      <p style="text-align:center;font-size:12px;color:${GRAY};margin-top:20px;line-height:1.6;">
        Bu e-posta Kobipo tarafından otomatik gönderilmiştir.<br />
        Bu işlemi siz başlatmadıysanız e-postayı yok sayabilirsiniz.
      </p>
    </div>
  </body>
</html>`
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:linear-gradient(90deg,${BLUE},${MID});color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:12px;">${escapeHtml(
    label
  )}</a>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${NAVY};">${escapeHtml(
    text
  )}</h1>`
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:${TEXT};">${html}</p>`
}

function fallbackLink(url: string): string {
  return `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${GRAY};">
    Buton çalışmazsa şu bağlantıyı tarayıcınıza yapıştırın:<br />
    <a href="${url}" style="color:${BLUE};word-break:break-all;">${escapeHtml(url)}</a>
  </p>`
}

/** Yeni (sistemde kaydı olmayan) bir kişiyi şube müdürü olarak davet e-postası. */
export function branchManagerInviteEmail(params: {
  inviteUrl: string
  branchName: string
  parentName?: string | null
}): { subject: string; html: string } {
  const { inviteUrl, branchName, parentName } = params
  const orgLabel = parentName
    ? `<strong>${escapeHtml(parentName)}</strong> firmasının <strong>${escapeHtml(
        branchName
      )}</strong> şubesi`
    : `<strong>${escapeHtml(branchName)}</strong> şubesi`

  const bodyHtml = `
    ${heading("Şube Müdürü Daveti")}
    ${paragraph(`${orgLabel} için <strong>Şube Müdürü</strong> olarak davet edildiniz.`)}
    ${paragraph("Daveti kabul edip hesabınızı oluşturmak için aşağıdaki butona tıklayın:")}
    <div style="margin:24px 0;">${button(inviteUrl, "Daveti Kabul Et")}</div>
    ${fallbackLink(inviteUrl)}
  `
  return {
    subject: `Kobipo — ${branchName} şubesi için şube müdürü daveti`,
    html: layout({ title: "Şube Müdürü Daveti", bodyHtml }),
  }
}

/** Sistemde zaten kaydı olan bir kullanıcıya şube müdürü atandığı bildirimi. */
export function branchManagerAssignedEmail(params: {
  appUrl: string
  branchName: string
}): { subject: string; html: string } {
  const { appUrl, branchName } = params
  const bodyHtml = `
    ${heading("Şube Müdürü Olarak Atandınız")}
    ${paragraph(`<strong>${escapeHtml(branchName)}</strong> şubesi için <strong>Şube Müdürü</strong> olarak yetkilendirildiniz.`)}
    ${paragraph("Mevcut Kobipo hesabınızla giriş yaparak şubeyi yönetmeye başlayabilirsiniz.")}
    <div style="margin:24px 0;">${button(`${appUrl}/signin`, "Giriş Yap")}</div>
  `
  return {
    subject: `Kobipo — ${branchName} şubesi şube müdürü ataması`,
    html: layout({ title: "Şube Müdürü Ataması", bodyHtml }),
  }
}

/**
 * Personele haftalık vardiya planı.
 *
 * PLAN E-POSTANIN İÇİNDE, bir bağlantının arkasında değil: personelin Kobipo
 * hesabı yok (`Employee` ile `User` arasında bağ yok), dolayısıyla tıklayacağı
 * bir panel de yok. Herkese hesap açmak yerine planı doğrudan göndermek, bu
 * fazın çözmesi gereken sorunu — "personel planı hiç görmüyor" — tek adımda
 * çözüyor; telefonda açılan e-posta mutfak duvarındaki çizelgenin yerini tutar.
 *
 * Satırlar ÇAĞIRAN tarafından hazırlanır (gün etiketi + saat metni), çünkü gün
 * ve süre biçimleri lib/personel/vardiya.ts'te tanımlı ve e-posta katmanının
 * bunları yeniden türetmesi iki ayrı biçim doğururdu.
 */
export function shiftScheduleEmail(params: {
  employeeName: string
  companyName: string
  weekLabel: string
  rows: { day: string; text: string; muted?: boolean }[]
  totalLabel: string
}): { subject: string; html: string } {
  const { employeeName, companyName, weekLabel, rows, totalLabel } = params

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;color:${TEXT};white-space:nowrap;">${escapeHtml(
          r.day,
        )}</td>
        <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${
          r.muted ? GRAY : TEXT
        };font-weight:${r.muted ? "400" : "600"};">${escapeHtml(r.text)}</td>
      </tr>`,
    )
    .join("")

  const bodyHtml = `
    ${heading("Vardiya Planınız")}
    ${paragraph(`Merhaba ${escapeHtml(employeeName)},`)}
    ${paragraph(
      `<strong>${escapeHtml(companyName)}</strong> · <strong>${escapeHtml(
        weekLabel,
      )}</strong> haftası için vardiya planınız aşağıdadır.`,
    )}
    <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
      ${tableRows}
    </table>
    ${paragraph(`<span style="color:${GRAY};font-size:13px;">Haftalık toplam: <strong style="color:${TEXT};">${escapeHtml(
      totalLabel,
    )}</strong></span>`)}
    ${paragraph(
      `<span style="color:${GRAY};font-size:13px;">Planla ilgili bir sorunuz varsa yöneticinize iletin. Plan değişirse size güncel hali yeniden gönderilir.</span>`,
    )}
  `
  return {
    subject: `Kobipo — ${weekLabel} vardiya planınız`,
    html: layout({ title: "Vardiya Planı", bodyHtml }),
  }
}

/** Şifre sıfırlama bağlantısı e-postası (1 saat geçerli). */
export function passwordResetEmail(params: {
  resetUrl: string
  userName?: string | null
}): { subject: string; html: string } {
  const { resetUrl, userName } = params
  const greeting = userName
    ? `Merhaba ${escapeHtml(userName)},`
    : "Merhaba,"
  const bodyHtml = `
    ${heading("Şifre Sıfırlama")}
    ${paragraph(greeting)}
    ${paragraph("Hesabınız için bir şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki butona tıklayın:")}
    <div style="margin:24px 0;">${button(resetUrl, "Şifremi Sıfırla")}</div>
    ${paragraph(`<span style="color:${GRAY};font-size:13px;">Bu bağlantı <strong>1 saat</strong> boyunca geçerlidir. Bu talebi siz yapmadıysanız hiçbir işlem yapmanıza gerek yoktur; şifreniz değişmez.</span>`)}
    ${fallbackLink(resetUrl)}
  `
  return {
    subject: "Kobipo — Şifre sıfırlama talebi",
    html: layout({ title: "Şifre Sıfırlama", bodyHtml }),
  }
}

/**
 * Abonelik bitişi uyarısı — üç hâli tek şablon karşılar, çünkü üçünün de tek çağrısı
 * var: yenile.
 *
 *   expiring → dönem bitmek üzere, erişim sürüyor.
 *   grace    → dönem BİTTİ ve ödeme alınamadı; erişim `locksAt`e kadar sürüyor. Bu
 *              hâlde söylenmesi gereken tarih dönem bitişi DEĞİL, kapanış tarihidir.
 *   expired  → erişim kapandı.
 *
 * `grace` ayrı bir hâl olarak duruyor çünkü sebebi farklı: dönem bitmiş değil, ÖDEME
 * ALINAMAMIŞ. "Aboneliğiniz sona erdi" demek, kartı reddedilen müşteriye yanlış bilgi
 * verir — erişimi hâlâ açıktır ve yapması gereken şey ödemeyi düzeltmektir.
 */
export function subscriptionNoticeEmail(params: {
  kind: "expiring" | "grace" | "expired"
  daysLeft: number
  endsAt: Date
  /** Modüllerin gerçekten kapanacağı an — hoşgörü süresi yüzünden `endsAt`'ten sonra olabilir. */
  locksAt: Date
  companyName: string
  renewUrl: string
  userName?: string | null
}): { subject: string; html: string } {
  const { kind, daysLeft, endsAt, locksAt, companyName, renewUrl, userName } = params
  const trDate = (d: Date) =>
    d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
  const dateLabel = trDate(endsAt)
  const lockLabel = trDate(locksAt)
  // Hoşgörü süresi varsa kapanış dönem bitişinden SONRA; metin bunu söylemeli.
  const hasGrace = locksAt.getTime() > endsAt.getTime()

  const title =
    kind === "expired"
      ? "Aboneliğiniz sona erdi"
      : kind === "grace"
        ? "Ödemeniz alınamadı"
        : "Aboneliğiniz sona eriyor"

  const lead =
    kind === "expired"
      ? `<strong>${escapeHtml(companyName)}</strong> hesabınızın Kobipo aboneliği <strong>${escapeHtml(
          dateLabel,
        )}</strong> tarihinde sona erdi.`
      : kind === "grace"
        ? `<strong>${escapeHtml(companyName)}</strong> hesabınızın ödenmiş dönemi <strong>${escapeHtml(
            dateLabel,
          )}</strong> tarihinde doldu ve yenileme ödemesi alınamadı.`
        : daysLeft === 1
          ? `<strong>${escapeHtml(
              companyName,
            )}</strong> hesabınızın Kobipo aboneliği <strong>yarın</strong> (${escapeHtml(
              dateLabel,
            )}) sona eriyor.`
          : `<strong>${escapeHtml(
              companyName,
            )}</strong> hesabınızın Kobipo aboneliği <strong>${daysLeft} gün sonra</strong> (${escapeHtml(
              dateLabel,
            )}) sona eriyor.`

  const detail =
    kind === "expired"
      ? "Satın aldığınız modüller kapandı; panelde yalnız ayarlar ile e-Dönüşüm kalır. Verileriniz silinmez; aboneliği yenilediğinizde kaldığınız yerden devam edersiniz."
      : kind === "grace"
        ? `Erişiminiz kapanmadı: modülleriniz <strong>${escapeHtml(
            lockLabel,
          )}</strong> tarihine kadar açık kalmaya devam ediyor. Bu tarihe kadar ödeme alınamazsa modüller kapanır ve panelde yalnız ayarlar ile e-Dönüşüm kalır. Verileriniz silinmez.`
        : hasGrace
          ? `Yenilemezseniz modülleriniz <strong>${escapeHtml(
              lockLabel,
            )}</strong> tarihinde kapanır (dönem bitiminden sonra kısa bir ek süre tanınır).`
          : `Yenilemezseniz modülleriniz <strong>${escapeHtml(
              lockLabel,
            )}</strong> tarihinde kapanır.`

  const bodyHtml = `
    ${heading(title)}
    ${paragraph(userName ? `Merhaba ${escapeHtml(userName)},` : "Merhaba,")}
    ${paragraph(lead)}
    ${paragraph(detail)}
    <div style="margin:24px 0;">${button(renewUrl, kind === "grace" ? "Ödemeyi Tamamla" : "Aboneliği Yenile")}</div>
    ${fallbackLink(renewUrl)}
  `

  const subject =
    kind === "expired"
      ? `Kobipo — ${companyName} aboneliği sona erdi`
      : kind === "grace"
        ? `Kobipo — ${companyName} ödemesi alınamadı, erişiminiz ${lockLabel} tarihinde kapanacak`
        : `Kobipo — ${companyName} aboneliği ${daysLeft === 1 ? "yarın" : `${daysLeft} gün sonra`} sona eriyor`

  return { subject, html: layout({ title, bodyHtml }) }
}
