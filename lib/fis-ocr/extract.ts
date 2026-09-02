/**
 * Fiş görselini modele okutur. SUNUCU tarafı — anahtar tarayıcıya gitmez.
 *
 * Sağlayıcı OpenRouter: tek anahtarla birden çok modeli aynı arayüzden çağırmak
 * ölçüm fazında gerekiyor. Üretime geçerken doğrudan Google'ın OpenAI-uyumlu ucuna
 * dönmek `TABAN_URL` + model adı değişikliğinden ibaret; router payı (~%5) o zaman
 * ortadan kalkar.
 */

import sharp from "sharp"
import {
  TARAMA_PROMPT,
  TARAMA_SEMA,
  type Fis,
  type FisOdeme,
  type FisOdemeSekli,
} from "./schema"
import { VARSAYILAN_MODEL } from "./models"

export { VARSAYILAN_MODEL, DENENEBILIR_MODELLER } from "./models"

const TABAN_URL = "https://openrouter.ai/api/v1/chat/completions"


/**
 * Küçültme ön hazırlık DEĞİL, işin parçası: ham telefon fotoğrafı ~14 kat fazla
 * token yakar ve doğruluğa katkısı ölçülmedi. Tezgâh da aynı boyutla ölçüyor —
 * ikisi ayrışırsa ölçümün maliyet rakamları üretimi temsil etmez.
 */
const UZUN_KENAR = 1568

export type TaramaKullanim = {
  girdiToken: number
  ciktiToken: number
  dusunmeToken: number
  maliyetUsd: number | null
}

export type TaramaSonucu = {
  fisler: Fis[]
  model: string
  saglayici: string
  semaliydi: boolean
  sureMs: number
  kullanim: TaramaKullanim
  gorsel: { genislik: number; yukseklik: number; boyutKb: number }
}

export class TaramaHatasi extends Error {
  constructor(
    message: string,
    readonly hamYanit?: string
  ) {
    super(message)
  }
}

/** Model bazen kod bloğuyla sarar, bazen şemayı yok sayıp düz DİZİ döner. */
function jsonAyikla(metin: string): any {
  const adaylar: string[] = []
  const ilkObj = metin.indexOf("{")
  const sonObj = metin.lastIndexOf("}")
  const ilkDizi = metin.indexOf("[")
  const sonDizi = metin.lastIndexOf("]")
  if (ilkDizi !== -1 && sonDizi > ilkDizi && (ilkObj === -1 || ilkDizi < ilkObj)) {
    adaylar.push(metin.slice(ilkDizi, sonDizi + 1))
  }
  if (ilkObj !== -1 && sonObj > ilkObj) adaylar.push(metin.slice(ilkObj, sonObj + 1))
  for (const aday of adaylar) {
    try {
      return JSON.parse(aday)
    } catch {
      /* sıradaki adayı dene */
    }
  }
  throw new TaramaHatasi("Model yanıtı JSON'a çevrilemedi", metin)
}

/**
 * Ödeme şeklini kümeye zorlar.
 *
 * Küme şemaya `enum` olarak YAZILAMIYOR (strict json_schema'da enum + null
 * bileşimi bazı sağlayıcılarda reddediliyor), yani modelin küme dışına çıkması
 * mümkün: "KREDI KARTI", "Kredi Kartı", "CARD", hatta "TEB". Serbest metni
 * olduğu gibi geçirirsek tahsilat kanalı seçimi sessizce boşa düşer.
 *
 * Tanımadığı değeri null yapar — yanlış kanala yazmaktansa kullanıcıya sordurur.
 */
const ODEME_KUMESI: FisOdemeSekli[] = ["NAKIT", "KREDI_KARTI", "YEMEK_KARTI", "HAVALE"]

export function normalizeOdeme(ham: unknown): FisOdeme | null {
  if (!ham || typeof ham !== "object") return null
  const o = ham as Record<string, unknown>
  const sade = String(o.sekil ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[^A-ZÇĞİÖŞÜ]/g, "")
  const eslesen = ODEME_KUMESI.find((k) => k.replace(/_/g, "") === sade) ?? null
  const tutar =
    typeof o.tutar === "number" && Number.isFinite(o.tutar) ? o.tutar : null
  return { sekil: eslesen, tutar }
}

export async function fisTara(
  dosya: Buffer,
  secenek: { model?: string } = {}
): Promise<TaramaSonucu> {
  const anahtar = process.env.OPENROUTER_API_KEY
  if (!anahtar) {
    throw new TaramaHatasi("OPENROUTER_API_KEY tanımlı değil — .env.local'e ekleyin")
  }
  const model = secenek.model || VARSAYILAN_MODEL

  const kucuk = await sharp(dosya)
    .rotate() // EXIF yönü: telefon fotoğrafı yan gelirse model fişi okuyamaz
    .resize({ width: UZUN_KENAR, height: UZUN_KENAR, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const olcu = await sharp(kucuk).metadata()

  const govde: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: TARAMA_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64," + kucuk.toString("base64") },
          },
          { type: "text", text: "Bu fişi çıkar." },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0,
    // Gerçek maliyeti sağlayıcı söylesin; kendi fiyat tablomuzu tutarsak
    // fiyat değiştiğinde ekran yalan söyler.
    usage: { include: true },
    response_format: {
      type: "json_schema",
      json_schema: { name: "fis", strict: true, schema: TARAMA_SEMA },
    },
    // Bu bayrak olmadan, şemayı desteklemeyen sağlayıcı 400 DÖNMÜYOR: şemayı
    // sessizce yok sayıp kendi uydurduğu alan adlarıyla cevap veriyor.
    provider: { require_parameters: true },
  }

  const t0 = Date.now()
  const yanit = await fetch(TABAN_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + anahtar,
      "Content-Type": "application/json",
      "X-Title": "Kobipo fis tarama",
    },
    body: JSON.stringify(govde),
  })

  if (!yanit.ok) {
    const hata = await yanit.text()
    if (yanit.status === 402) {
      throw new TaramaHatasi("OpenRouter kredisi yetersiz — hesaba kredi yükleyin")
    }
    throw new TaramaHatasi(`Sağlayıcı ${yanit.status} döndü: ${hata.slice(0, 300)}`)
  }

  const j = await yanit.json()
  const sureMs = Date.now() - t0
  const metin: string = j.choices?.[0]?.message?.content ?? ""
  const ham = jsonAyikla(metin)

  // Şemayı yok sayan sağlayıcı düz dizi ya da tek fiş dönebilir; tek biçime indir.
  const fisler: Fis[] = Array.isArray(ham)
    ? ham
    : Array.isArray(ham.fisler)
      ? ham.fisler
      : [ham]

  const u = j.usage ?? {}
  return {
    fisler: fisler.map((f) => ({
      ...f,
      kalemler: Array.isArray(f.kalemler) ? f.kalemler : [],
      odeme: normalizeOdeme(f.odeme),
    })),
    model,
    saglayici: j.provider ?? "?",
    semaliydi: true,
    sureMs,
    kullanim: {
      girdiToken: u.prompt_tokens ?? 0,
      ciktiToken: u.completion_tokens ?? 0,
      dusunmeToken: u.completion_tokens_details?.reasoning_tokens ?? 0,
      maliyetUsd: typeof u.cost === "number" ? u.cost : null,
    },
    gorsel: {
      genislik: olcu.width ?? 0,
      yukseklik: olcu.height ?? 0,
      boyutKb: Math.round(kucuk.length / 1024),
    },
  }
}
