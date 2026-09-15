/**
 * Şablon gövdesinin AYRIŞTIRICISI — saf, istemcide de çalışır.
 *
 * Gövde kullanıcı yazımı HTML'dir. İki şey lazım ve ikisi de AYNI ayrıştırmadan
 * çıkmalı:
 *   1. `govdeTemizle()` — saklanan/önizlenen güvenli HTML,
 *   2. `govdePdfIcerigi()` — pdfmake içeriği.
 * Ayrı ayrı yazılsalardı önizlemede görünen ile PDF'e basılan zamanla ayrışırdı;
 * kullanıcı ekranda gördüğü belgeyi imzaya gönderiyor.
 *
 * GÜVENLİK: izin listesi dar ve ÖZNİTELİKLER TAMAMEN ATILIR. Gövde sistem yönetim
 * panelinden de firma kullanıcısından da gelebiliyor; `onclick`, `style`,
 * `javascript:` bağlantısı ya da `<script>` gövdeye girerse önizleme onu tarayıcıda
 * çalıştırırdı. Öznitelik ayıklamak yerine hepsini atmak, izin listesini tek
 * satırda denetlenebilir tutar.
 */

import type { Content } from "pdfmake/interfaces"
import { FS, mm } from "@/lib/pdf/doc/theme"
import { softBreak } from "@/lib/pdf/doc/safe-text"

/** Blok etiketleri — kendi satırını açar. */
const BLOK = new Set(["p", "h3", "h4", "ul", "ol", "li"])
/** Satır içi biçim etiketleri. */
const SATIR_ICI = new Set(["strong", "b", "em", "i", "u", "br"])
/** İçeriğiyle birlikte TAMAMEN atılanlar (metni de kalmaz). */
const YUTULAN = new Set(["script", "style", "iframe", "object", "embed", "svg"])

const IZINLI = new Set([...BLOK, ...SATIR_ICI])

type Jeton =
  | { tur: "metin"; deger: string }
  | { tur: "ac"; etiket: string }
  | { tur: "kapat"; etiket: string }

/**
 * HTML'i jetonlara böler. Öznitelikler okunmaz bile: `<p class="x">` → `ac p`.
 *
 * Ayrıştırıcı hoşgörülüdür (kapatılmamış etiket, fazladan kapatma) çünkü gövde elle
 * yazılabiliyor; hatalı işaretleme belgeyi BOŞ döndürmemeli, elinden geldiğince
 * basmalı.
 */
function jetonla(html: string): Jeton[] {
  const jetonlar: Jeton[] = []
  const desen = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  let son = 0
  let eslesme: RegExpExecArray | null
  let yutulanEtiket: string | null = null

  const metinEkle = (ham: string) => {
    if (yutulanEtiket) return
    const metin = cozEntity(ham)
    if (metin) jetonlar.push({ tur: "metin", deger: metin })
  }

  while ((eslesme = desen.exec(html)) !== null) {
    metinEkle(html.slice(son, eslesme.index))
    son = desen.lastIndex

    const etiket = eslesme[1].toLowerCase()
    const kapatma = eslesme[0].startsWith("</")

    if (yutulanEtiket) {
      // Yutulan bloğun içindeyiz: yalnız kendi kapanışı bizi çıkarır.
      if (kapatma && etiket === yutulanEtiket) yutulanEtiket = null
      continue
    }
    if (YUTULAN.has(etiket)) {
      if (!kapatma) yutulanEtiket = etiket
      continue
    }
    if (!IZINLI.has(etiket)) continue // bilinmeyen etiket düşer, METNİ kalır

    jetonlar.push(kapatma ? { tur: "kapat", etiket } : { tur: "ac", etiket })
  }
  metinEkle(html.slice(son))
  return jetonlar
}

const ENTITYLER: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function cozEntity(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (tam, kod: string) => {
    if (kod.startsWith("#")) {
      const sayi = kod[1] === "x" || kod[1] === "X" ? parseInt(kod.slice(2), 16) : parseInt(kod.slice(1), 10)
      return Number.isFinite(sayi) && sayi > 0 && sayi < 0x110000 ? String.fromCodePoint(sayi) : ""
    }
    return ENTITYLER[kod.toLowerCase()] ?? tam
  })
}

function kacisla(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Saklanacak/önizlenecek güvenli HTML.
 *
 * Jetonlardan YENİDEN KURULUR — gelen metni "süzmek" yerine yeniden yazmak, gözden
 * kaçan bir öznitelik ya da yarım etiketin çıktıya sızmasını imkânsız kılar.
 */
export function govdeTemizle(html: string): string {
  const parcalar: string[] = []
  const yigin: string[] = []

  for (const jeton of jetonla(html || "")) {
    if (jeton.tur === "metin") {
      parcalar.push(kacisla(jeton.deger))
      continue
    }
    if (jeton.etiket === "br") {
      if (jeton.tur === "ac") parcalar.push("<br>")
      continue
    }
    if (jeton.tur === "ac") {
      yigin.push(jeton.etiket)
      parcalar.push(`<${jeton.etiket}>`)
    } else {
      // Fazladan kapatma yok sayılır; yığında varsa oraya kadar kapatılır.
      const yer = yigin.lastIndexOf(jeton.etiket)
      if (yer === -1) continue
      while (yigin.length > yer) parcalar.push(`</${yigin.pop()}>`)
    }
  }
  while (yigin.length) parcalar.push(`</${yigin.pop()}>`)
  return parcalar.join("").trim()
}

/** Gövdedeki düz metin — arama, özet ve "boş mu" denetimi için. */
export function govdeDuzMetin(html: string): string {
  return jetonla(html || "")
    .map((j) => (j.tur === "metin" ? j.deger : j.tur === "ac" && j.etiket === "br" ? "\n" : ""))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim()
}

// ————————————————————— PDF —————————————————————

type Bicim = { bold?: boolean; italics?: boolean; decoration?: "underline" }

/**
 * Gövdeyi pdfmake içeriğine çevirir.
 *
 * Antet ve imza bloğu BURADAN GELMEZ: onları `personel-pdf.ts` çizer. Gövde yalnız
 * metindir — böylece kullanıcı şablonu istediği gibi değiştirse de belge kurumsal
 * çerçevesini korur.
 */
export function govdePdfIcerigi(html: string): Content[] {
  const icerik: Content[] = []
  const bicimYigini: Bicim[] = []
  let paragraf: Array<{ text: string } & Bicim> = []
  let liste: { tur: "ul" | "ol"; ogeler: Content[] } | null = null
  let blok: "p" | "h3" | "h4" | "li" | null = null

  const aktifBicim = (): Bicim => Object.assign({}, ...bicimYigini)

  const paragrafiKapat = () => {
    if (!paragraf.length) {
      blok = null
      return
    }
    const parcalar = paragraf
    paragraf = []

    if (blok === "li" && liste) {
      liste.ogeler.push({ text: parcalar })
    } else if (blok === "h3" || blok === "h4") {
      icerik.push({
        text: parcalar.map((p) => ({ ...p, bold: true })),
        fontSize: blok === "h3" ? FS.h2 : FS.body,
        margin: [0, mm(4), 0, mm(1.5)],
      })
    } else {
      icerik.push({ text: parcalar, fontSize: FS.body, margin: [0, 0, 0, mm(2.5)] })
    }
    blok = null
  }

  const listeyiKapat = () => {
    if (!liste) return
    const { tur, ogeler } = liste
    liste = null
    if (!ogeler.length) return
    icerik.push(
      tur === "ul"
        ? { ul: ogeler, fontSize: FS.body, margin: [0, 0, 0, mm(2.5)] }
        : { ol: ogeler, fontSize: FS.body, margin: [0, 0, 0, mm(2.5)] },
    )
  }

  for (const jeton of jetonla(html || "")) {
    if (jeton.tur === "metin") {
      // softBreak: uzun kırılmaz dizeler (IBAN, URL) satır taşırmasın.
      const metin = jeton.deger.replace(/\s+/g, " ")
      if (!metin.trim() && !paragraf.length) continue
      paragraf.push({ text: softBreak(metin), ...aktifBicim() })
      continue
    }

    const { etiket } = jeton
    if (etiket === "br") {
      if (jeton.tur === "ac") paragraf.push({ text: "\n", ...aktifBicim() })
      continue
    }

    if (SATIR_ICI.has(etiket)) {
      if (jeton.tur === "ac") {
        bicimYigini.push(
          etiket === "strong" || etiket === "b"
            ? { bold: true }
            : etiket === "u"
              ? { decoration: "underline" }
              : { italics: true },
        )
      } else {
        bicimYigini.pop()
      }
      continue
    }

    // Blok etiketleri
    if (jeton.tur === "ac") {
      paragrafiKapat()
      if (etiket === "ul" || etiket === "ol") {
        listeyiKapat()
        liste = { tur: etiket, ogeler: [] }
      } else if (etiket === "li") {
        blok = "li"
      } else {
        listeyiKapat()
        blok = etiket as "p" | "h3" | "h4"
      }
    } else {
      paragrafiKapat()
      if (etiket === "ul" || etiket === "ol") listeyiKapat()
    }
  }
  paragrafiKapat()
  listeyiKapat()
  return icerik
}
