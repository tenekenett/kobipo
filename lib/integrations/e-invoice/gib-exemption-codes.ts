/**
 * GİB KDV istisna kodları (UBL-TR `TaxExemptionReasonCode`) — KDV %0'lı kalemde
 * seçilebilen kodların TEK kaynağı. Fatura editörünün seçicisi ve Excel içe
 * aktarımının doğrulaması buradan okur.
 *
 * Bu modül bilinçli olarak bağımlılıksızdır (saf veri) — hem sunucu hem "use client"
 * fatura editörü tarafından import edilir.
 *
 * KAYNAK: GİB e-Fatura paketi `UBL-TR_Codelist.xml` (v1.43, 27.07.2026; 14.09.2026'dan
 * geçerli). Kod kümesi = `istisnaTaxExemptionReasonCodeType` içindeki 2xx/3xx kodlar
 * + 351, eksi Yatırım Teşvik'e taşınan 308/339. Adlar Mysoft'un
 * `GET /api/GeneralCard/taxExemptionReason` listesinden (GİB adlarının kopyası).
 *
 * Mysoft listesi TAM KAYNAK DEĞİLDİR (2026-09-28 ölçüldü): 233'ü içermiyor, GİB'in
 * reddettiği 308/339'u hâlâ veriyor. Her kod canlı GİB şematronundan
 * (`checkSchemaSchematronForInvoiceUBL`) ISTISNA tipinde geçirilerek ölçüldü —
 * bkz. scripts/istisna-kodu-kontrol.ts. GİB listeyi güncelleyince orası çalıştırılır.
 */

export type KdvExemptionCode = {
  code: string
  /** Belgeye istisna sebebi olarak da yazılabilen resmî ad. */
  name: string
  /** 2xx kısmi istisna (KDVK 17 vb.), 3xx tam istisna (KDVK 11/13/14/15...), 351 istisna değil. */
  group: "kismi" | "tam" | "istisna-degil"
}

const K = (code: string, name: string): KdvExemptionCode => ({ code, name, group: "kismi" })
const T = (code: string, name: string): KdvExemptionCode => ({ code, name, group: "tam" })

export const KDV_EXEMPTION_CODES: KdvExemptionCode[] = [
  K("201", "17/1 Kültür ve Eğitim Amacı Taşıyan İşlemler"),
  K("202", "17/2-a Sağlık, Çevre Ve Sosyal Yardım Amaçlı İşlemler"),
  K("204", "17/2-c Yabancı Diplomatik Organ Ve Hayır Kurumlarının Yapacakları Bağışlarla İlgili Mal Ve Hizmet Alışları"),
  K("205", "17/2-d Taşınmaz Kültür Varlıklarına İlişkin Teslimler ve Mimarlık Hizmetleri"),
  K("206", "17/2-e Mesleki Kuruluşların İşlemleri"),
  K("207", "17/3 Askeri Fabrika, Tersane ve Atölyelerin İşlemleri"),
  K("208", "17/4-c Birleşme, Devir, Dönüşüm ve Bölünme İşlemleri"),
  K("209", "17/4-e Banka ve Sigorta Muameleleri Vergisi Kapsamına Giren İşlemler"),
  K("211", "17/4-h Zirai Amaçlı Su Teslimleri İle Köy Tüzel Kişiliklerince Yapılan İçme Suyu Teslimleri"),
  K("212", "17/4-ı Serbest Bölgelerde Verilen Hizmetler"),
  K("213", "17/4-j Boru Hattı İle Yapılan Petrol Ve Gaz Taşımacılığı"),
  K("214", "17/4-k Organize Sanayi Bölgelerindeki Arsa ve İşyeri Teslimleri İle Konut Yapı Kooperatiflerinin Üyelerine Konut Teslimleri"),
  K("215", "17/4-l Varlık Yönetim Şirketlerinin İşlemleri"),
  K("216", "17/4-m Tasarruf Mevduatı Sigorta Fonunun İşlemleri"),
  K("217", "17/4-n Basın-Yayın ve Enformasyon Genel Müdürlüğüne Verilen Haber Hizmetleri"),
  K("218", "KDV 17/4-o md. Gümrük Antrepoları, Geçici Depolama Yerleri ile Gümrüklü Sahalarda Vergisiz Satış Yapılan İşyeri, Depo ve Ardiye Gibi Bağımsız Birimlerin Kiralanması"),
  K("219", "17/4-p Hazine ve Arsa Ofisi Genel Müdürlüğünün işlemleri"),
  K("220", "17/4-r İki Tam Yıl Süreyle Sahip Olunan Taşınmaz ve İştirak Hisseleri Satışları"),
  K("221", "Geçici 15 Konut Yapı Kooperatifleri, Belediyeler ve Sosyal Güvenlik Kuruluşlarına Verilen İnşaat Taahhüt Hizmeti"),
  K("223", "Geçici 20/1 Teknoloji Geliştirme Bölgelerinde Yapılan İşlemler"),
  K("225", "Geçici 23 Milli Eğitim Bakanlığına Yapılan Bilgisayar Bağışları İle İlgili Teslimler"),
  K("226", "17/2-b Özel Okulları, Üniversite ve Yüksekokullar Tarafından Verilen Bedelsiz Eğitim Ve Öğretim Hizmetleri"),
  K("227", "17/2-b Kanunların Gösterdiği Gerek Üzerine Bedelsiz Olarak Yapılan Teslim ve Hizmetler"),
  K("228", "17/2-b Kanunun (17/1) Maddesinde Sayılan Kurum ve Kuruluşlara Bedelsiz Olarak Yapılan Teslimler"),
  K("229", "17/2-b Gıda Bankacılığı Faaliyetinde Bulunan Dernek ve Vakıflara Bağışlanan Gıda, Temizlik, Giyecek ve Yakacak Maddeleri"),
  K("230", "17/4-g Külçe Altın, Külçe Gümüş Ve Kıymetli Taşların Teslimi"),
  K("231", "17/4-g Metal, Plastik, Lastik, Kauçuk, Kağıt, Cam Hurda Ve Atıkların Teslimi"),
  K("232", "17/4-g Döviz, Para, Damga Pulu, Değerli Kağıtlar, Hisse Senedi ve Tahvil Teslimleri"),
  // UBL-TR v1.43 ile eklendi (14.09.2026). Mysoft listesinde henüz YOK; GİB şematronu kabul ediyor.
  K("233", "2942 Sayılı Kamulaştırma Kanunu Kapsamında Taşınmazların Kamulaştırmayı Yapan Devlet ve Kamu Tüzel Kişilerine Devri"),
  K("234", "17/4-ş Konut Finansmanı Amacıyla Teminat Gösterilen ve İpotek Konulan Konutların Teslimi"),
  K("235", "16/1-c Transit ve Gümrük Antrepo Rejimleri İle Geçici Depolama ve Serbest Bölge Hükümlerinin Uygulandığı Malların Teslimi"),
  K("236", "19/2 Usulüne Göre Yürürlüğe Girmiş Uluslararası Anlaşmalar Kapsamındaki İstisnalar (İade Hakkı Tanınmayan)"),
  K("237", "17/4-t 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimlerinden Sonraki Teslim"),
  K("238", "17/4-u Varlıkların Varlık Kiralama Şirketlerine Devri İle Bu Varlıkların Varlık Kiralama Şirketlerince Kiralanması ve Devralınan Kuruma Devri"),
  K("239", "17/4-y Taşınmazların Finansal Kiralama Şirketlerine Devri, Finansal Kiralama Şirketi Tarafından Devredene Kiralanması ve Devri"),
  K("240", "17/4-z Patentli Veya Faydalı Model Belgeli Buluşa İlişkin Gayri Maddi Hakların Kiralanması, Devri ve Satışı"),
  K("241", "TürkAkım Gaz Boru Hattı Projesine İlişkin Anlaşmanın (9/b) Maddesinde Yer Alan Hizmetler"),
  K("242", "KDV 17/4-ö md. Gümrük Antrepoları, Geçici Depolama Yerleri ile Gümrüklü Sahalarda, İthalat ve İhracat İşlemlerine konu mallar ile transit rejim kapsamında işlem gören mallar için verilen ardiye, depolama ve terminal hizmetleri"),
  // GİB adı yalnız "Diğerleri" (350 ile aynı) — seçicide ikisi ayırt edilsin diye grup yazılır.
  K("250", "Diğerleri (kısmi istisna)"),
  T("301", "11/1-a Mal İhracatı"),
  T("302", "11/1-a Hizmet İhracatı"),
  T("303", "11/1-a Roaming Hizmetleri"),
  T("304", "13/a Deniz Hava ve Demiryolu Taşıma Araçlarının Teslimi İle İnşa, Tadil, Bakım ve Onarımları"),
  T("305", "13/b Deniz ve Hava Taşıma Araçları İçin Liman Ve Hava Meydanlarında Yapılan Hizmetler"),
  T("306", "13/c Petrol Aramaları ve Petrol Boru Hatlarının İnşa ve Modernizasyonuna İlişkin Yapılan Teslim ve Hizmetler"),
  T("307", "13/c Maden Arama, Altın, Gümüş, ve Platin Madenleri İçin İşletme, Zenginleştirme Ve Rafinaj Faaliyetlerine İlişkin Teslim Ve Hizmetler [KDVGUT-(II/8-4)]"),
  T("309", "13/e Liman Ve Hava Meydanlarının İnşası, Yenilenmesi Ve Genişletilmesi"),
  T("310", "13/f Ulusal Güvenlik Amaçlı Teslim ve Hizmetler"),
  T("311", "14/1 Uluslararası Taşımacılık"),
  T("312", "15/a Diplomatik Organ Ve Misyonlara Yapılan Teslim ve Hizmetler"),
  T("313", "15/b Uluslararası Kuruluşlara Yapılan Teslim ve Hizmetler"),
  T("314", "19/2 Usulüne Göre Yürürlüğe Girmiş Uluslar Arası Anlaşmalar Kapsamındaki İstisnalar"),
  T("315", "14/3 İhraç Konusu Eşyayı Taşıyan Kamyon, Çekici ve Yarı Romorklara Yapılan Motorin Teslimleri"),
  T("316", "11/1-a Serbest Bölgelerdeki Müşteriler İçin Yapılan Fason Hizmetler"),
  T("317", "17/4-s Engellilerin Eğitimleri, Meslekleri ve Günlük Yaşamlarına İlişkin Araç-Gereç ve Bilgisayar Programları"),
  T("318", "Geçici 29 3996 Sayılı Kanuna Göre Yap-İşlet-Devret Modeli Çerçevesinde Gerçekleştirilecek Projeler, 3359 Sayılı Kanuna Göre Kiralama Karşılığı Yaptırılan Sağlık Tesislerine İlişkin Projeler ve 652 Sayılı Kanun Hükmünde Kararnameye Göre Kiralama Karşılığı Yaptırılan Eğitim Öğretim Tesislerine İlişkin Projelere İlişkin Teslim ve Hizmetler"),
  T("319", "13/g Başbakanlık Merkez Teşkilatına Yapılan Araç Teslimleri"),
  T("320", "Geçici 16 (6111 sayılı K.) İSMEP Kapsamında İstanbul İl Özel İdaresi'ne Bağlı Olarak Faaliyet Gösteren \"İstanbul Proje Koordinasyon Birimi\"ne Yapılacak Teslim ve Hizmetler"),
  T("321", "Geçici 26 Birleşmiş Milletler (BM) ile Kuzey Atlantik Antlaşması Teşkilatı (NATO) Temsilcilikleri ve Bu Teşkilatlara Bağlı Program, Fon ve Özel İhtisas Kuruluşları ile İktisadi İşbirliği ve Kalkınma Teşkilatına (OECD) Resmi Kullanımları İçin Yapılacak Mal Teslimi ve Hizmet İfaları, Bunların Sosyal ve Ekonomik Yardım Amacıyla Bedelsiz Olarak Yapacakları Mal Teslimi ve Hizmet İfaları İle İlgili Bunlara Yapılan Mal Teslimi ve Hizmet İfaları"),
  T("322", "11/1-a Türkiye'de İkamet Etmeyenlere Özel Fatura ile Yapılan Teslimler (Bavul Ticareti)"),
  T("323", "13/ğ 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimi"),
  T("324", "13/h Türkiye Kızılay Derneğine Yapılan Teslim ve Hizmetler ile Türkiye Kızılay Derneğinin Teslim ve Hizmetleri"),
  T("325", "13/ı Yem Teslimleri"),
  T("326", "13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin Teslimi"),
  T("327", "13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin İçeriğinde Bulunan Hammaddelerin Gübre Üreticilerine Teslimi"),
  T("328", "13/i Konut veya İşyeri Teslimleri"),
  T("329", "Fatih projesi kapsamında Milli Eğitim Bakanlığına Yapılacak Mal ve Hizmet Teslimleri"),
  T("330", "KDV 13/j md. Organize Sanayi Bölgeleri ile Küçük Sanayi Sitelerinin İnşasına İlişkin Teslim ve Hizmetler"),
  T("331", "KDV 13/m md. Ar-Ge, Yenilik ve Tasarım Faaliyetlerinde Kullanılmak Üzere Yapılan Yeni Makina ve Teçhizat Teslimlerinde İstisna"),
  T("332", "KDV Geçici 39. Md. İmalat Sanayiinde Kullanılmak Üzere Yapılan Yeni Makina ve Teçhizat Teslimlerinde İstisna"),
  T("333", "KDV 13/k md. Kapsamında Genel ve Özel Bütçeli Kamu İdarelerine, İl Özel İdarelerine, Belediyelere ve Köylere bağışlanan Tesislerin İnşasına İlişkin İstisna"),
  T("334", "KDV 13/l md. Kapsamında Yabancılara Verilen Sağlık Hizmetlerinde İstisna"),
  T("335", "KDV 13/n Basılı Kitap ve Süreli Yayınların Teslimleri"),
  T("336", "Geçici 40 UEFA Müsabakaları Kapsamında Yapılacak Teslim ve Hizmetler"),
  T("337", "Türk Akım Gaz Boru Hattı Projesine İlişkin Anlaşmanın (9/h) Maddesi Kapsamındaki Gaz Taşıma Hizmetleri"),
  T("338", "İmalatçıların Mal İhracatları"),
  T("340", "Elektrik Motorlu Taşıt Araçlarının Geliştirilmesine Yönelik Mühendislik Hizmetleri"),
  T("341", "Afetzedelere Bağışlanacak Konutların İnşasına İlişkin İstisna"),
  T("342", "Genel Bütçeli Kamu İdarelerine Bağışlanacak Taşınmazların İnşasına İlişkin İstisna"),
  T("343", "Genel Bütçeli Kamu İdarelerine Bağışlanacak Konutların Yabancı Devlet Kurum ve Kuruluşlarına Teslimine İlişkin İstisna"),
  T("344", "13/o Milli Savunma ve İç Güvenlik İhtiyaçlarında Kullanılmak Üzere Taşıt Teslimi"),
  T("350", "Diğerleri (tam istisna)"),
  { code: "351", name: "KDV - İstisna Olmayan Diğer", group: "istisna-degil" },
]

const BY_CODE = new Map(KDV_EXEMPTION_CODES.map((c) => [c.code, c] as const))

/**
 * GİB listesinde OLAN ama KDV %0'lı kalemde seçilemeyen kodlar ve nedeni. Seçiciye
 * bilerek konmadılar: Kobipo'nun kestiği tiplerde (SATIS/ISTISNA/IADE) belge ya
 * GİB'den döner ya da yanlış beyana gider. İçe aktarım bu metinle reddeder.
 */
const NOT_SELECTABLE: Array<{ codes: string[]; reason: string }> = [
  {
    codes: ["001", "101", "102", "103", "104", "105", "106", "107", "108", "151"],
    reason: "ÖTV istisna kodudur; KDV %0'lı kalemde kullanılmaz.",
  },
  {
    codes: ["501"],
    reason: "KDV hesaplanarak yapılan satış kodudur; KDV %0'lı kalemde kullanılmaz.",
  },
  {
    codes: ["555"],
    reason: "GİB bu kodla KDV'nin 0 geçilmesine izin vermez.",
  },
  {
    codes: ["308", "339"],
    reason: "Yatırım teşvik (YTB) faturalarına özgüdür; Kobipo bu fatura tipini kesmiyor.",
  },
  {
    codes: ["701", "702", "703", "704"],
    reason: "İhraç kayıtlı fatura tipine özgüdür; Kobipo bu fatura tipini henüz kesmiyor.",
  },
  {
    codes: ["801", "802", "803", "804", "805", "806", "807", "808", "809", "810", "811", "812"],
    reason: "Özel matrah fatura tipine özgüdür; Kobipo bu fatura tipini henüz kesmiyor.",
  },
]

const NOT_SELECTABLE_REASON = new Map(
  NOT_SELECTABLE.flatMap(({ codes, reason }) => codes.map((code) => [code, reason] as const)),
)

export function kdvExemption(code?: string | null): KdvExemptionCode | undefined {
  return BY_CODE.get(String(code ?? "").trim())
}

/**
 * KDV %0'lı kalem için istisna kodunun neden kabul edilmediği; kod geçerliyse null.
 * Boş kod burada sorulmaz (zorunluluk çağıranın kararı).
 */
export function kdvExemptionCodeError(code: string): string | null {
  const c = code.trim()
  if (BY_CODE.has(c)) return null
  const reason = NOT_SELECTABLE_REASON.get(c)
  if (reason) return `KDV İstisna Kodu ${c}: ${reason}`
  return `KDV İstisna Kodu ${c} GİB listesinde yok.`
}
