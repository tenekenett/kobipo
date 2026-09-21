/**
 * Model çağrısı — TEK sağlayıcı katmanı. SUNUCU tarafı, anahtar tarayıcıya gitmez.
 *
 * `lib/fis-ocr/extract.ts`ten TAŞINDI (2026-09-21, belge tarama Faz 0): fiş,
 * sınıflandırıcı, fatura, irsaliye, dekont ve çek okuyucuları aynı çağrıyı
 * kullanır. Davranış fişteki ile birebir (temperature 0, strict json_schema,
 * `require_parameters`, gerçek maliyet sağlayıcıdan) — fiş tezgâhı taşımadan
 * sonra aynı sayıları vermeli, ölçüm `scripts/ai-belge-test.ts --tur fis`.
 *
 * Sağlayıcı OpenRouter: tek anahtarla birden çok modeli aynı arayüzden çağırmak
 * ölçüm fazında gerekiyor. Üretime geçerken doğrudan Google'ın OpenAI-uyumlu
 * ucuna dönmek `TABAN_URL` + model adı değişikliğinden ibaret.
 *
 * TEK EKLEME: 429/5xx'te iki yeniden deneme. Tezgâhta baştan beri vardı ("üretimde
 * de bu döngü gerekecek"), uygulama yolunda yoktu; açık model sağlayıcıları
 * birinci taraf API'lerden belirgin biçimde kırılgan. Başarılı yanıtın işlenişi
 * değişmedi — yeniden deneme yalnız hata yolunu etkiler.
 */

const TABAN_URL = "https://openrouter.ai/api/v1/chat/completions"

export type ModelKullanimi = {
  girdiToken: number
  ciktiToken: number
  dusunmeToken: number
  maliyetUsd: number | null
}

/** Modele giden içerik parçası. Görsel JPEG olarak küçültülmüş gelir (bkz. girdi/gorsel.ts). */
export type IcerikParcasi =
  | { tip: "gorsel"; jpeg: Buffer }
  | { tip: "metin"; metin: string }

export type ModelIstegi = {
  model: string
  /** system mesajı — türe özel prompt */
  sistem: string
  /** user mesajının parçaları: görseller ve/veya metin, sırayla */
  icerik: IcerikParcasi[]
  /** user mesajının sonundaki komut ("Bu fişi çıkar.") */
  komut: string
  /** strict json_schema */
  semaAdi: string
  sema: object
  maxToken?: number
  /** Gemini 3.x'te akıl yürütme kapatılamıyor ama seviyesi kısılabiliyor. */
  akil?: "low" | "medium" | "high"
  /** OpenRouter X-Title başlığı (panelde görünen ad) */
  baslik?: string
}

export type ModelYaniti = {
  /** JSON'a çevrilmiş ham çıktı — şema doğrulaması ÇAĞIRANIN işi */
  ham: any
  model: string
  saglayici: string
  sureMs: number
  kullanim: ModelKullanimi
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
export function jsonAyikla(metin: string): any {
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

const YENIDEN_DENENIR = new Set([429, 500, 502, 503, 504])

export async function modeleSor(istek: ModelIstegi): Promise<ModelYaniti> {
  const anahtar = process.env.OPENROUTER_API_KEY
  if (!anahtar) {
    throw new TaramaHatasi("OPENROUTER_API_KEY tanımlı değil — .env.local'e ekleyin")
  }

  const parcalar = istek.icerik.map((p) =>
    p.tip === "gorsel"
      ? {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64," + p.jpeg.toString("base64") },
        }
      : { type: "text", text: p.metin }
  )

  const govde: Record<string, unknown> = {
    model: istek.model,
    messages: [
      { role: "system", content: istek.sistem },
      { role: "user", content: [...parcalar, { type: "text", text: istek.komut }] },
    ],
    max_tokens: istek.maxToken ?? 4000,
    temperature: 0,
    // Gerçek maliyeti sağlayıcı söylesin; kendi fiyat tablomuzu tutarsak
    // fiyat değiştiğinde ekran yalan söyler.
    usage: { include: true },
    response_format: {
      type: "json_schema",
      json_schema: { name: istek.semaAdi, strict: true, schema: istek.sema },
    },
    // Bu bayrak olmadan, şemayı desteklemeyen sağlayıcı 400 DÖNMÜYOR: şemayı
    // sessizce yok sayıp kendi uydurduğu alan adlarıyla cevap veriyor.
    provider: { require_parameters: true },
  }
  if (istek.akil) govde.reasoning = { effort: istek.akil }

  const t0 = Date.now()
  let yanit: Response | null = null
  for (let deneme = 0; ; deneme++) {
    yanit = await fetch(TABAN_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + anahtar,
        "Content-Type": "application/json",
        "X-Title": istek.baslik ?? "Kobipo belge tarama",
      },
      body: JSON.stringify(govde),
    })
    if (yanit.ok || !YENIDEN_DENENIR.has(yanit.status) || deneme >= 2) break
    await new Promise((c) => setTimeout(c, 2000 * (deneme + 1)))
  }

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
  const u = j.usage ?? {}
  return {
    ham,
    model: istek.model,
    saglayici: j.provider ?? "?",
    sureMs,
    kullanim: {
      girdiToken: u.prompt_tokens ?? 0,
      ciktiToken: u.completion_tokens ?? 0,
      dusunmeToken: u.completion_tokens_details?.reasoning_tokens ?? 0,
      maliyetUsd: typeof u.cost === "number" ? u.cost : null,
    },
  }
}

/** İki ölçümü toplar — çok geçişli okumada (sınıf + tür) kare maliyeti tek sayı olsun. */
export function kullanimTopla(...k: ModelKullanimi[]): ModelKullanimi {
  return k.reduce(
    (a, b) => ({
      girdiToken: a.girdiToken + b.girdiToken,
      ciktiToken: a.ciktiToken + b.ciktiToken,
      dusunmeToken: a.dusunmeToken + b.dusunmeToken,
      maliyetUsd:
        a.maliyetUsd == null && b.maliyetUsd == null ? null : (a.maliyetUsd ?? 0) + (b.maliyetUsd ?? 0),
    }),
    { girdiToken: 0, ciktiToken: 0, dusunmeToken: 0, maliyetUsd: null }
  )
}
