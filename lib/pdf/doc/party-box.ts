import type { Content } from "pdfmake/interfaces"
import { softBreak } from "./safe-text"
import { COLORS, FS, mm } from "./theme"

/**
 * Firma / müşteri / tedarikçi bilgi bloğu.
 *
 * Kutu SABİT YÜKSEKLİKTE DEĞİL: satır sayısı kadar uzar, uzun unvan ve adres
 * kendi sütun genişliğinde sarılır. Eski jsPDF sürümünde kutu 28mm sabitti, ad
 * 78mm'ye kırpılıp sağ sütun `slice(0,3)` ile 3 satıra budanıyordu — bilgi
 * sessizce kayboluyor ya da kutudan taşıyordu.
 */

export type PartyLike = {
  name?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  district?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
}

/** Cari/firma künyesini satırlara çevirir (boş alanlar atlanır). */
export function partyLines(p: PartyLike): string[] {
  const lines: string[] = []
  if (p.taxNumber) lines.push(`VKN: ${p.taxNumber}${p.taxOffice ? ` / ${p.taxOffice}` : ""}`)
  if (p.address) lines.push(p.address)
  const place = [p.district, p.city].filter(Boolean).join(" / ")
  if (place) lines.push(place)
  if (p.phone) lines.push(`Tel: ${p.phone}`)
  if (p.email) lines.push(`E-posta: ${p.email}`)
  if (p.website) lines.push(p.website)
  return lines
}

/** Gri kutu içinde iki sütunlu taraf bilgisi (sol: etiket + ad, sağ: künye). */
export function partyBox(label: string, party: PartyLike | null | undefined): Content {
  return {
    table: {
      widths: ["*", "*"],
      body: [
        [
          {
            stack: [
              { text: label, fontSize: FS.small, bold: true, margin: [0, 0, 0, mm(1)] },
              { text: softBreak(party?.name) || "—", style: "h2" },
            ],
            margin: [mm(2), mm(2), mm(1), mm(2)],
          },
          {
            stack: party ? partyLines(party).map((l) => ({ text: softBreak(l), style: "muted" })) : [],
            margin: [mm(1), mm(2), mm(2), mm(2)],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => COLORS.boxBg,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  }
}

/** Etiketsiz künye (belge başlığındaki firma bloğu). */
export function partyHeader(party: PartyLike): Content {
  return {
    stack: [
      { text: softBreak(party.name), style: "h1" },
      ...partyLines(party).map((l) => ({ text: softBreak(l), style: "muted" as const })),
    ],
  }
}
