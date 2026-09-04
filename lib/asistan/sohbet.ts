/**
 * Sohbet döngüsü — SUNUCU tarafı, anahtar tarayıcıya gitmez.
 *
 * Sağlayıcı OpenRouter: fiş taramadaki (`lib/fis-ocr/extract.ts`) ile aynı
 * gerekçe — tek anahtarla birden çok modeli aynı arayüzden çağırmak ÖLÇÜM
 * FAZINDA gerekiyor. Kazanan model belli olunca doğrudan sağlayıcının ucuna
 * dönmek `TABAN_URL` + model adı değişikliğinden ibaret; router payı (~%5) o
 * zaman ortadan kalkar.
 *
 * Araç döngüsü elle yazıldı, SDK kullanılmadı: `tools` biçimi sağlayıcılar
 * arasında ortak (OpenAI uyumlu), ama SDK'lar tek sağlayıcıya bağlar. Ölçüm
 * biterse bu dosya sadeleşir.
 */

import { aracCalistir, aracSemalari, type AracBaglami, type AracSonucu } from "./araclar"
import { VARSAYILAN_MODEL, modelGecerliMi } from "./modeller"
import { SISTEM_PROMPT, brifingMetni } from "./prompt"
import type { AsistanBrifing, SohbetKullanim, SohbetMesaji } from "./tipler"

const TABAN_URL = "https://openrouter.ai/api/v1/chat/completions"

/**
 * Model kaç tur araç çağırabilir.
 *
 * 4 turdan sonrası ölçümde hiç işe yaramadı: model ya aynı aracı farklı
 * parametrelerle deneyip duruyor ya da zaten cevaplayabileceği bir soruda
 * gezinmeye devam ediyor. Sınır olmasaydı tek soru onlarca sorgu ve dakikalarca
 * bekleme üretebilirdi.
 */
const AZAMI_TUR = 4

export class SohbetHatasi extends Error {
  constructor(
    message: string,
    readonly hamYanit?: string
  ) {
    super(message)
  }
}

type OpenRouterMesaj = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export type SohbetSonucu = {
  cevap: string
  model: string
  saglayici: string
  /** Hangi araçlar, hangi parametrelerle çağrıldı — şeffaflık ve ölçüm için. */
  araclar: AracSonucu[]
  kullanim: SohbetKullanim
}

/**
 * Modelin ürettiği araç argümanı JSON'unu çözer.
 *
 * Bozuk JSON SESSİZCE boş nesneye düşürülmez: parametresiz çalışan bir araç
 * (ör. `donem_ozeti`) bozuk argümanla da cevap üretir ve model yanlış dönemi
 * doğru sanır. Bozuksa araca hata metni gider.
 */
function argumanCoz(ham: string): { ok: true; deger: Record<string, unknown> } | { ok: false; hata: string } {
  if (!ham || ham.trim() === "") return { ok: true, deger: {} }
  try {
    const cozulen = JSON.parse(ham)
    if (cozulen && typeof cozulen === "object" && !Array.isArray(cozulen)) {
      return { ok: true, deger: cozulen as Record<string, unknown> }
    }
    return { ok: false, hata: "Araç parametreleri bir nesne olmalı." }
  } catch {
    return { ok: false, hata: `Araç parametreleri okunamadı: ${ham.slice(0, 200)}` }
  }
}

export async function sohbetEt(args: {
  brifing: AsistanBrifing
  gecmis: SohbetMesaji[]
  soru: string
  aracBaglami: AracBaglami
  model?: string
}): Promise<SohbetSonucu> {
  const anahtar = process.env.OPENROUTER_API_KEY
  if (!anahtar) {
    throw new SohbetHatasi("OPENROUTER_API_KEY tanımlı değil — .env.local'e ekleyin")
  }
  const model = modelGecerliMi(args.model) ? (args.model as string) : VARSAYILAN_MODEL
  const tools = aracSemalari(args.aracBaglami)

  const mesajlar: OpenRouterMesaj[] = [
    { role: "system", content: SISTEM_PROMPT },
    // Brifing AYRI bir system mesajı: sistem prompt'u sabit, brifing her istekte
    // değişiyor. Tek parça olsalardı sağlayıcının prompt önbelleği hiç tutmazdı.
    { role: "system", content: brifingMetni(args.brifing) },
    ...args.gecmis.map<OpenRouterMesaj>((m) => ({
      role: m.rol === "kullanici" ? "user" : "assistant",
      content: m.metin,
    })),
    { role: "user", content: args.soru },
  ]

  const araclar: AracSonucu[] = []
  let girdiToken = 0
  let ciktiToken = 0
  let maliyet: number | null = null
  let saglayici = "?"
  const t0 = Date.now()

  for (let tur = 0; tur < AZAMI_TUR; tur++) {
    const yanit = await fetch(TABAN_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + anahtar,
        "Content-Type": "application/json",
        "X-Title": "Kobipo isletme asistani",
      },
      body: JSON.stringify({
        model,
        messages: mesajlar,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 1500,
        temperature: 0.3,
        // Gerçek maliyeti sağlayıcı söylesin; kendi fiyat tablomuzu tutarsak
        // fiyat değiştiğinde ölçüm raporu yalan söyler.
        usage: { include: true },
      }),
    })

    if (!yanit.ok) {
      const hata = await yanit.text()
      if (yanit.status === 402) {
        throw new SohbetHatasi("OpenRouter kredisi yetersiz — hesaba kredi yükleyin")
      }
      throw new SohbetHatasi(`Sağlayıcı ${yanit.status} döndü: ${hata.slice(0, 300)}`)
    }

    const j = await yanit.json()
    saglayici = j.provider ?? saglayici
    const u = j.usage ?? {}
    girdiToken += u.prompt_tokens ?? 0
    ciktiToken += u.completion_tokens ?? 0
    if (typeof u.cost === "number") maliyet = (maliyet ?? 0) + u.cost

    const secim = j.choices?.[0]
    const mesaj = secim?.message
    if (!mesaj) throw new SohbetHatasi("Model boş yanıt döndü", JSON.stringify(j).slice(0, 500))

    const cagrilar = Array.isArray(mesaj.tool_calls) ? mesaj.tool_calls : []

    if (cagrilar.length === 0) {
      const cevap = typeof mesaj.content === "string" ? mesaj.content.trim() : ""
      if (!cevap) throw new SohbetHatasi("Model boş cevap üretti")
      return {
        cevap,
        model,
        saglayici,
        araclar,
        kullanim: {
          girdiToken,
          ciktiToken,
          maliyetUsd: maliyet,
          aracTuru: araclar.length,
          sureMs: Date.now() - t0,
        },
      }
    }

    // Asistan turunu geçmişe olduğu gibi geri koy — araç sonuçları ancak
    // çağrının kendisiyle eşleşirse anlamlı.
    mesajlar.push({ role: "assistant", content: mesaj.content ?? null, tool_calls: cagrilar })

    // Aynı turdaki çağrılar paralel: model üç aracı birden isterse sırayla
    // beklemek gecikmeyi üçe katlardı.
    const sonuclar = await Promise.all(
      cagrilar.map(async (c: { id: string; function: { name: string; arguments: string } }) => {
        const cozum = argumanCoz(c.function.arguments)
        if (!cozum.ok) {
          return {
            id: c.id,
            sonuc: { ad: c.function.name, girdi: {}, cikti: { hata: cozum.hata }, sureMs: 0 },
          }
        }
        const sonuc = await aracCalistir(c.function.name, cozum.deger, args.aracBaglami)
        return { id: c.id, sonuc }
      })
    )

    for (const { id, sonuc } of sonuclar) {
      araclar.push(sonuc)
      mesajlar.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify(sonuc.cikti),
      })
    }
  }

  // Tur sınırına dayandık: modele son bir kez, araçsız cevap yazdır.
  const kapanis = await fetch(TABAN_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + anahtar,
      "Content-Type": "application/json",
      "X-Title": "Kobipo isletme asistani",
    },
    body: JSON.stringify({
      model,
      messages: [
        ...mesajlar,
        {
          role: "system",
          content:
            "Araç çağırma hakkın bitti. Elindeki sonuçlarla cevabı ŞİMDİ yaz. Eksik kalan bir şey varsa neyi göremediğini söyle.",
        },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      usage: { include: true },
    }),
  })

  if (!kapanis.ok) {
    throw new SohbetHatasi(`Sağlayıcı ${kapanis.status} döndü (kapanış turu)`)
  }

  const kj = await kapanis.json()
  const ku = kj.usage ?? {}
  girdiToken += ku.prompt_tokens ?? 0
  ciktiToken += ku.completion_tokens ?? 0
  if (typeof ku.cost === "number") maliyet = (maliyet ?? 0) + ku.cost

  const kapanisCevap = kj.choices?.[0]?.message?.content
  return {
    cevap:
      typeof kapanisCevap === "string" && kapanisCevap.trim()
        ? kapanisCevap.trim()
        : "Soruyu cevaplamak için gereken veriye ulaşamadım.",
    model,
    saglayici,
    araclar,
    kullanim: {
      girdiToken,
      ciktiToken,
      maliyetUsd: maliyet,
      aracTuru: araclar.length,
      sureMs: Date.now() - t0,
    },
  }
}
