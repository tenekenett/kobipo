/**
 * TEKDÜZEN HESAP PLANI — sınıf (1 hane), grup (2 hane) ve defteri kebir (3 hane)
 * hesapları. Saf veri; firmaya kurulumu muhasebe motorunun 2. fazında.
 *
 * Kaynak: Muhasebe Sistemi Uygulama Genel Tebliği (MSUGT) hesap çerçevesi ve
 * hesap planı; maliyet hesaplarında 7/A seçeneği (7/B ve 8–9 nazım sınıfları yok —
 * KOBİ'lerin neredeyse tamamı 7/A kullanır). Alt hesaplar (120.01.001 …) plan
 * verisi değildir, firmada açılır.
 *
 * Neden tam plan: Aposkal boş planla başlıyor ve her hesabı fiş içinden açtırıyor
 * (incelemede KDV alt hesabına cari adı önerdi). Kobipo tam planla başlar; kullanıcı
 * yalnız alt hesap açar.
 */

export type HesapTuru = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE"

export type TekduzenHesabi = {
  kod: string
  ad: string
  /** 1 = sınıf, 2 = grup, 3 = defteri kebir hesabı. */
  duzey: 1 | 2 | 3
  tur: HesapTuru
  /**
   * Düzenleyici (ters) hesap — adında "(-)" olan: normal bakiyesi türünün
   * TERSİDİR (ör. 257 Birikmiş Amortismanlar varlık sınıfında ama alacak bakiyeli).
   */
  ters: boolean
}

type Satir = readonly [kod: string, ad: string]

// Sınıf ve grup başlıkları.
const BASLIKLAR: readonly Satir[] = [
  ["1", "DÖNEN VARLIKLAR"],
  ["10", "HAZIR DEĞERLER"],
  ["11", "MENKUL KIYMETLER"],
  ["12", "TİCARİ ALACAKLAR"],
  ["13", "DİĞER ALACAKLAR"],
  ["15", "STOKLAR"],
  ["17", "YILLARA YAYGIN İNŞAAT VE ONARIM MALİYETLERİ"],
  ["18", "GELECEK AYLARA AİT GİDERLER VE GELİR TAHAKKUKLARI"],
  ["19", "DİĞER DÖNEN VARLIKLAR"],
  ["2", "DURAN VARLIKLAR"],
  ["22", "TİCARİ ALACAKLAR"],
  ["23", "DİĞER ALACAKLAR"],
  ["24", "MALİ DURAN VARLIKLAR"],
  ["25", "MADDİ DURAN VARLIKLAR"],
  ["26", "MADDİ OLMAYAN DURAN VARLIKLAR"],
  ["27", "ÖZEL TÜKENMEYE TABİ VARLIKLAR"],
  ["28", "GELECEK YILLARA AİT GİDERLER VE GELİR TAHAKKUKLARI"],
  ["29", "DİĞER DURAN VARLIKLAR"],
  ["3", "KISA VADELİ YABANCI KAYNAKLAR"],
  ["30", "MALİ BORÇLAR"],
  ["32", "TİCARİ BORÇLAR"],
  ["33", "DİĞER BORÇLAR"],
  ["34", "ALINAN AVANSLAR"],
  ["35", "YILLARA YAYGIN İNŞAAT VE ONARIM HAKEDİŞLERİ"],
  ["36", "ÖDENECEK VERGİ VE DİĞER YÜKÜMLÜLÜKLER"],
  ["37", "BORÇ VE GİDER KARŞILIKLARI"],
  ["38", "GELECEK AYLARA AİT GELİRLER VE GİDER TAHAKKUKLARI"],
  ["39", "DİĞER KISA VADELİ YABANCI KAYNAKLAR"],
  ["4", "UZUN VADELİ YABANCI KAYNAKLAR"],
  ["40", "MALİ BORÇLAR"],
  ["42", "TİCARİ BORÇLAR"],
  ["43", "DİĞER BORÇLAR"],
  ["44", "ALINAN AVANSLAR"],
  ["47", "BORÇ VE GİDER KARŞILIKLARI"],
  ["48", "GELECEK YILLARA AİT GELİRLER VE GİDER TAHAKKUKLARI"],
  ["49", "DİĞER UZUN VADELİ YABANCI KAYNAKLAR"],
  ["5", "ÖZ KAYNAKLAR"],
  ["50", "ÖDENMİŞ SERMAYE"],
  ["52", "SERMAYE YEDEKLERİ"],
  ["54", "KÂR YEDEKLERİ"],
  ["57", "GEÇMİŞ YILLAR KÂRLARI"],
  ["58", "GEÇMİŞ YILLAR ZARARLARI (-)"],
  ["59", "DÖNEM NET KÂRI (ZARARI)"],
  ["6", "GELİR TABLOSU HESAPLARI"],
  ["60", "BRÜT SATIŞLAR"],
  ["61", "SATIŞ İNDİRİMLERİ (-)"],
  ["62", "SATIŞLARIN MALİYETİ (-)"],
  ["63", "FAALİYET GİDERLERİ (-)"],
  ["64", "DİĞER FAALİYETLERDEN OLAĞAN GELİR VE KÂRLAR"],
  ["65", "DİĞER FAALİYETLERDEN OLAĞAN GİDER VE ZARARLAR (-)"],
  ["66", "FİNANSMAN GİDERLERİ (-)"],
  ["67", "OLAĞANDIŞI GELİR VE KÂRLAR"],
  ["68", "OLAĞANDIŞI GİDER VE ZARARLAR (-)"],
  ["69", "DÖNEM NET KÂRI VEYA ZARARI"],
  ["7", "MALİYET HESAPLARI"],
  ["71", "DİREKT İLK MADDE VE MALZEME GİDERLERİ"],
  ["72", "DİREKT İŞÇİLİK GİDERLERİ"],
  ["73", "GENEL ÜRETİM GİDERLERİ"],
  ["74", "HİZMET ÜRETİM MALİYETİ"],
  ["75", "ARAŞTIRMA VE GELİŞTİRME GİDERLERİ"],
  ["76", "PAZARLAMA, SATIŞ VE DAĞITIM GİDERLERİ"],
  ["77", "GENEL YÖNETİM GİDERLERİ"],
  ["78", "FİNANSMAN GİDERLERİ"],
]

// Defteri kebir hesapları.
const HESAPLAR: readonly Satir[] = [
  // 10
  ["100", "Kasa"],
  ["101", "Alınan Çekler"],
  ["102", "Bankalar"],
  ["103", "Verilen Çekler ve Ödeme Emirleri (-)"],
  ["108", "Diğer Hazır Değerler"],
  // 11
  ["110", "Hisse Senetleri"],
  ["111", "Özel Kesim Tahvil, Senet ve Bonoları"],
  ["112", "Kamu Kesimi Tahvil, Senet ve Bonoları"],
  ["118", "Diğer Menkul Kıymetler"],
  ["119", "Menkul Kıymetler Değer Düşüklüğü Karşılığı (-)"],
  // 12
  ["120", "Alıcılar"],
  ["121", "Alacak Senetleri"],
  ["122", "Alacak Senetleri Reeskontu (-)"],
  ["124", "Kazanılmamış Finansal Kiralama Faiz Gelirleri (-)"],
  ["126", "Verilen Depozito ve Teminatlar"],
  ["127", "Diğer Ticari Alacaklar"],
  ["128", "Şüpheli Ticari Alacaklar"],
  ["129", "Şüpheli Ticari Alacaklar Karşılığı (-)"],
  // 13
  ["131", "Ortaklardan Alacaklar"],
  ["132", "İştiraklerden Alacaklar"],
  ["133", "Bağlı Ortaklıklardan Alacaklar"],
  ["135", "Personelden Alacaklar"],
  ["136", "Diğer Çeşitli Alacaklar"],
  ["137", "Diğer Alacak Senetleri Reeskontu (-)"],
  ["138", "Şüpheli Diğer Alacaklar"],
  ["139", "Şüpheli Diğer Alacaklar Karşılığı (-)"],
  // 15
  ["150", "İlk Madde ve Malzeme"],
  ["151", "Yarı Mamuller - Üretim"],
  ["152", "Mamuller"],
  ["153", "Ticari Mallar"],
  ["157", "Diğer Stoklar"],
  ["158", "Stok Değer Düşüklüğü Karşılığı (-)"],
  ["159", "Verilen Sipariş Avansları"],
  // 17
  ["170", "Yıllara Yaygın İnşaat ve Onarım Maliyetleri"],
  ["178", "Yıllara Yaygın İnşaat Enflasyon Düzeltme Hesabı"],
  ["179", "Taşeronlara Verilen Avanslar"],
  // 18
  ["180", "Gelecek Aylara Ait Giderler"],
  ["181", "Gelir Tahakkukları"],
  // 19
  ["190", "Devreden KDV"],
  ["191", "İndirilecek KDV"],
  ["192", "Diğer KDV"],
  ["193", "Peşin Ödenen Vergiler ve Fonlar"],
  ["195", "İş Avansları"],
  ["196", "Personel Avansları"],
  ["197", "Sayım ve Tesellüm Noksanları"],
  ["198", "Diğer Çeşitli Dönen Varlıklar"],
  ["199", "Diğer Dönen Varlıklar Karşılığı (-)"],
  // 22
  ["220", "Alıcılar"],
  ["221", "Alacak Senetleri"],
  ["222", "Alacak Senetleri Reeskontu (-)"],
  ["224", "Kazanılmamış Finansal Kiralama Faiz Gelirleri (-)"],
  ["226", "Verilen Depozito ve Teminatlar"],
  ["229", "Şüpheli Alacaklar Karşılığı (-)"],
  // 23
  ["231", "Ortaklardan Alacaklar"],
  ["232", "İştiraklerden Alacaklar"],
  ["233", "Bağlı Ortaklıklardan Alacaklar"],
  ["235", "Personelden Alacaklar"],
  ["236", "Diğer Çeşitli Alacaklar"],
  ["237", "Diğer Alacak Senetleri Reeskontu (-)"],
  ["239", "Şüpheli Diğer Alacaklar Karşılığı (-)"],
  // 24
  ["240", "Bağlı Menkul Kıymetler"],
  ["241", "Bağlı Menkul Kıymetler Değer Düşüklüğü Karşılığı (-)"],
  ["242", "İştirakler"],
  ["243", "İştiraklere Sermaye Taahhütleri (-)"],
  ["244", "İştirakler Sermaye Payları Değer Düşüklüğü Karşılığı (-)"],
  ["245", "Bağlı Ortaklıklar"],
  ["246", "Bağlı Ortaklıklara Sermaye Taahhütleri (-)"],
  ["247", "Bağlı Ortaklıklar Sermaye Payları Değer Düşüklüğü Karşılığı (-)"],
  ["248", "Diğer Mali Duran Varlıklar"],
  ["249", "Diğer Mali Duran Varlıklar Karşılığı (-)"],
  // 25
  ["250", "Arazi ve Arsalar"],
  ["251", "Yeraltı ve Yerüstü Düzenleri"],
  ["252", "Binalar"],
  ["253", "Tesis, Makine ve Cihazlar"],
  ["254", "Taşıtlar"],
  ["255", "Demirbaşlar"],
  ["256", "Diğer Maddi Duran Varlıklar"],
  ["257", "Birikmiş Amortismanlar (-)"],
  ["258", "Yapılmakta Olan Yatırımlar"],
  ["259", "Verilen Avanslar"],
  // 26
  ["260", "Haklar"],
  ["261", "Şerefiye"],
  ["262", "Kuruluş ve Örgütlenme Giderleri"],
  ["263", "Araştırma ve Geliştirme Giderleri"],
  ["264", "Özel Maliyetler"],
  ["267", "Diğer Maddi Olmayan Duran Varlıklar"],
  ["268", "Birikmiş Amortismanlar (-)"],
  ["269", "Verilen Avanslar"],
  // 27
  ["271", "Arama Giderleri"],
  ["272", "Hazırlık ve Geliştirme Giderleri"],
  ["277", "Diğer Özel Tükenmeye Tabi Varlıklar"],
  ["278", "Birikmiş Tükenme Payları (-)"],
  ["279", "Verilen Avanslar"],
  // 28
  ["280", "Gelecek Yıllara Ait Giderler"],
  ["281", "Gelir Tahakkukları"],
  // 29
  ["291", "Gelecek Yıllarda İndirilecek KDV"],
  ["292", "Diğer KDV"],
  ["293", "Gelecek Yıllar İhtiyacı Stoklar"],
  ["294", "Elden Çıkarılacak Stoklar ve Maddi Duran Varlıklar"],
  ["295", "Peşin Ödenen Vergiler ve Fonlar"],
  ["297", "Diğer Çeşitli Duran Varlıklar"],
  ["298", "Stok Değer Düşüklüğü Karşılığı (-)"],
  ["299", "Birikmiş Amortismanlar (-)"],
  // 30
  ["300", "Banka Kredileri"],
  ["301", "Finansal Kiralama İşlemlerinden Borçlar"],
  ["302", "Ertelenmiş Finansal Kiralama Borçlanma Maliyetleri (-)"],
  ["303", "Uzun Vadeli Kredilerin Anapara Taksitleri ve Faizleri"],
  ["304", "Tahvil Anapara Borç, Taksit ve Faizleri"],
  ["305", "Çıkarılmış Bonolar ve Senetler"],
  ["306", "Çıkarılmış Diğer Menkul Kıymetler"],
  ["308", "Menkul Kıymetler İhraç Farkı (-)"],
  ["309", "Diğer Mali Borçlar"],
  // 32
  ["320", "Satıcılar"],
  ["321", "Borç Senetleri"],
  ["322", "Borç Senetleri Reeskontu (-)"],
  ["326", "Alınan Depozito ve Teminatlar"],
  ["329", "Diğer Ticari Borçlar"],
  // 33
  ["331", "Ortaklara Borçlar"],
  ["332", "İştiraklere Borçlar"],
  ["333", "Bağlı Ortaklıklara Borçlar"],
  ["335", "Personele Borçlar"],
  ["336", "Diğer Çeşitli Borçlar"],
  ["337", "Diğer Borç Senetleri Reeskontu (-)"],
  // 34
  ["340", "Alınan Sipariş Avansları"],
  ["349", "Alınan Diğer Avanslar"],
  // 35
  ["350", "Yıllara Yaygın İnşaat ve Onarım Hakediş Bedelleri"],
  // 36
  ["360", "Ödenecek Vergi ve Fonlar"],
  ["361", "Ödenecek Sosyal Güvenlik Kesintileri"],
  ["368", "Vadesi Geçmiş, Ertelenmiş veya Taksitlendirilmiş Vergi ve Diğer Yükümlülükler"],
  ["369", "Ödenecek Diğer Yükümlülükler"],
  // 37
  ["370", "Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları"],
  ["371", "Dönem Kârının Peşin Ödenen Vergi ve Diğer Yükümlülükleri (-)"],
  ["372", "Kıdem Tazminatı Karşılığı"],
  ["373", "Maliyet Giderleri Karşılığı"],
  ["379", "Diğer Borç ve Gider Karşılıkları"],
  // 38
  ["380", "Gelecek Aylara Ait Gelirler"],
  ["381", "Gider Tahakkukları"],
  // 39
  ["391", "Hesaplanan KDV"],
  ["392", "Diğer KDV"],
  ["393", "Merkez ve Şubeler Cari Hesabı"],
  ["397", "Sayım ve Tesellüm Fazlaları"],
  ["399", "Diğer Çeşitli Yabancı Kaynaklar"],
  // 40
  ["400", "Banka Kredileri"],
  ["401", "Finansal Kiralama İşlemlerinden Borçlar"],
  ["402", "Ertelenmiş Finansal Kiralama Borçlanma Maliyetleri (-)"],
  ["405", "Çıkarılmış Tahviller"],
  ["407", "Çıkarılmış Diğer Menkul Kıymetler"],
  ["408", "Menkul Kıymetler İhraç Farkı (-)"],
  ["409", "Diğer Mali Borçlar"],
  // 42
  ["420", "Satıcılar"],
  ["421", "Borç Senetleri"],
  ["422", "Borç Senetleri Reeskontu (-)"],
  ["426", "Alınan Depozito ve Teminatlar"],
  ["429", "Diğer Ticari Borçlar"],
  // 43
  ["431", "Ortaklara Borçlar"],
  ["432", "İştiraklere Borçlar"],
  ["433", "Bağlı Ortaklıklara Borçlar"],
  ["436", "Diğer Çeşitli Borçlar"],
  ["437", "Diğer Borç Senetleri Reeskontu (-)"],
  ["438", "Kamuya Olan Ertelenmiş veya Taksitlendirilmiş Borçlar"],
  // 44
  ["440", "Alınan Sipariş Avansları"],
  ["449", "Alınan Diğer Avanslar"],
  // 47
  ["472", "Kıdem Tazminatı Karşılığı"],
  ["479", "Diğer Borç ve Gider Karşılıkları"],
  // 48
  ["480", "Gelecek Yıllara Ait Gelirler"],
  ["481", "Gider Tahakkukları"],
  // 49
  ["492", "Gelecek Yıllara Ertelenmiş veya Terkin Edilecek KDV"],
  ["493", "Tesise Katılma Payları"],
  ["499", "Diğer Çeşitli Uzun Vadeli Yabancı Kaynaklar"],
  // 50
  ["500", "Sermaye"],
  ["501", "Ödenmemiş Sermaye (-)"],
  ["502", "Sermaye Düzeltmesi Olumlu Farkları"],
  ["503", "Sermaye Düzeltmesi Olumsuz Farkları (-)"],
  // 52
  ["520", "Hisse Senedi İhraç Primleri"],
  ["521", "Hisse Senedi İptal Kârları"],
  ["522", "M.D.V. Yeniden Değerleme Artışları"],
  ["523", "İştirakler Yeniden Değerleme Artışları"],
  ["524", "Maliyet Artışları Fonu"],
  ["529", "Diğer Sermaye Yedekleri"],
  // 54
  ["540", "Yasal Yedekler"],
  ["541", "Statü Yedekleri"],
  ["542", "Olağanüstü Yedekler"],
  ["548", "Diğer Kâr Yedekleri"],
  ["549", "Özel Fonlar"],
  // 57–59
  ["570", "Geçmiş Yıllar Kârları"],
  ["580", "Geçmiş Yıllar Zararları (-)"],
  ["590", "Dönem Net Kârı"],
  ["591", "Dönem Net Zararı (-)"],
  // 60
  ["600", "Yurtiçi Satışlar"],
  ["601", "Yurtdışı Satışlar"],
  ["602", "Diğer Gelirler"],
  // 61
  ["610", "Satıştan İadeler (-)"],
  ["611", "Satış İskontoları (-)"],
  ["612", "Diğer İndirimler (-)"],
  // 62
  ["620", "Satılan Mamuller Maliyeti (-)"],
  ["621", "Satılan Ticari Mallar Maliyeti (-)"],
  ["622", "Satılan Hizmet Maliyeti (-)"],
  ["623", "Diğer Satışların Maliyeti (-)"],
  // 63
  ["630", "Araştırma ve Geliştirme Giderleri (-)"],
  ["631", "Pazarlama, Satış ve Dağıtım Giderleri (-)"],
  ["632", "Genel Yönetim Giderleri (-)"],
  // 64
  ["640", "İştiraklerden Temettü Gelirleri"],
  ["641", "Bağlı Ortaklıklardan Temettü Gelirleri"],
  ["642", "Faiz Gelirleri"],
  ["643", "Komisyon Gelirleri"],
  ["644", "Konusu Kalmayan Karşılıklar"],
  ["645", "Menkul Kıymet Satış Kârları"],
  ["646", "Kambiyo Kârları"],
  ["647", "Reeskont Faiz Gelirleri"],
  ["648", "Enflasyon Düzeltmesi Kârları"],
  ["649", "Diğer Olağan Gelir ve Kârlar"],
  // 65
  ["653", "Komisyon Giderleri (-)"],
  ["654", "Karşılık Giderleri (-)"],
  ["655", "Menkul Kıymet Satış Zararları (-)"],
  ["656", "Kambiyo Zararları (-)"],
  ["657", "Reeskont Faiz Giderleri (-)"],
  ["658", "Enflasyon Düzeltmesi Zararları (-)"],
  ["659", "Diğer Olağan Gider ve Zararlar (-)"],
  // 66
  ["660", "Kısa Vadeli Borçlanma Giderleri (-)"],
  ["661", "Uzun Vadeli Borçlanma Giderleri (-)"],
  // 67
  ["671", "Önceki Dönem Gelir ve Kârları"],
  ["679", "Diğer Olağandışı Gelir ve Kârlar"],
  // 68
  ["680", "Çalışmayan Kısım Gider ve Zararları (-)"],
  ["681", "Önceki Dönem Gider ve Zararları (-)"],
  ["689", "Diğer Olağandışı Gider ve Zararlar (-)"],
  // 69
  ["690", "Dönem Kârı veya Zararı"],
  ["691", "Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)"],
  ["692", "Dönem Net Kârı veya Zararı"],
  ["697", "Yıllara Yaygın İnşaat ve Onarım Kârları"],
  ["698", "Enflasyon Düzeltme Hesabı"],
  // 71
  ["710", "Direkt İlk Madde ve Malzeme Giderleri"],
  ["711", "Direkt İlk Madde ve Malzeme Yansıtma Hesabı"],
  ["712", "Direkt İlk Madde ve Malzeme Fiyat Farkı"],
  ["713", "Direkt İlk Madde ve Malzeme Miktar Farkı"],
  // 72
  ["720", "Direkt İşçilik Giderleri"],
  ["721", "Direkt İşçilik Giderleri Yansıtma Hesabı"],
  ["722", "Direkt İşçilik Ücret Farkları"],
  ["723", "Direkt İşçilik Süre (Zaman) Farkları"],
  // 73
  ["730", "Genel Üretim Giderleri"],
  ["731", "Genel Üretim Giderleri Yansıtma Hesabı"],
  ["732", "Genel Üretim Giderleri Bütçe Farkları"],
  ["733", "Genel Üretim Giderleri Verimlilik Farkları"],
  ["734", "Genel Üretim Giderleri Kapasite Farkları"],
  // 74
  ["740", "Hizmet Üretim Maliyeti"],
  ["741", "Hizmet Üretim Maliyeti Yansıtma Hesabı"],
  ["742", "Hizmet Üretim Maliyeti Fark Hesapları"],
  // 75
  ["750", "Araştırma ve Geliştirme Giderleri"],
  ["751", "Araştırma ve Geliştirme Giderleri Yansıtma Hesabı"],
  ["752", "Araştırma ve Geliştirme Gider Farkları"],
  // 76
  ["760", "Pazarlama, Satış ve Dağıtım Giderleri"],
  ["761", "Pazarlama, Satış ve Dağıtım Giderleri Yansıtma Hesabı"],
  ["762", "Pazarlama, Satış ve Dağıtım Giderleri Fark Hesabı"],
  // 77
  ["770", "Genel Yönetim Giderleri"],
  ["771", "Genel Yönetim Giderleri Yansıtma Hesabı"],
  ["772", "Genel Yönetim Gider Farkları Hesabı"],
  // 78
  ["780", "Finansman Giderleri"],
  ["781", "Finansman Giderleri Yansıtma Hesabı"],
  ["782", "Finansman Giderleri Fark Hesabı"],
]

/** 6. sınıfta gelir grupları; kalanı gider (indirim, maliyet, gider grupları). */
const GELIR_GRUPLARI = new Set(["60", "64", "67"])

/** Hesabın türü: sınıftan, 6. sınıfta gruptan. 69 dönem sonucu öz kaynağa kapanır. */
export function hesapTuru(kod: string): HesapTuru {
  switch (kod[0]) {
    case "1":
    case "2":
      return "ASSET"
    case "3":
    case "4":
      return "LIABILITY"
    case "5":
      return "EQUITY"
    case "6": {
      if (kod.length === 1) return "INCOME"
      const grup = kod.slice(0, 2)
      if (grup === "69") return "EQUITY"
      return GELIR_GRUPLARI.has(grup) ? "INCOME" : "EXPENSE"
    }
    default:
      return "EXPENSE"
  }
}

const kur = ([kod, ad]: Satir): TekduzenHesabi => ({
  kod,
  ad,
  duzey: kod.length as 1 | 2 | 3,
  tur: hesapTuru(kod),
  // 6. sınıfta "(-)" "gelirden düşülür" demektir ve tür (EXPENSE) bunu zaten
  // taşır: 610 Satıştan İadeler BORÇ bakiyelidir. Ters işaretlenseydi yön
  // ikinci kez dönüp alacağa çıkardı. Diğer sınıflarda "(-)" gerçek düzenleyici.
  ters: ad.includes("(-)") && kod[0] !== "6",
})

/** Planın tamamı, koda göre sıralı (sınıf → grup → hesap). */
export const TEKDUZEN_HESAP_PLANI: readonly TekduzenHesabi[] = [...BASLIKLAR, ...HESAPLAR]
  .map(kur)
  .sort((a, b) => a.kod.localeCompare(b.kod))

const KOD_HARITASI = new Map(TEKDUZEN_HESAP_PLANI.map((h) => [h.kod, h]))

export function tekduzenHesabi(kod: string): TekduzenHesabi | undefined {
  return KOD_HARITASI.get(kod)
}

/** Ana hesabın üstü: "120" → "12", "12" → "1", "1" → null. */
export function ustKod(kod: string): string | null {
  return kod.length > 1 ? kod.slice(0, kod.length - 1) : null
}

/**
 * Normal bakiye yönü: varlık ve gider BORÇ, kaynak ve gelir ALACAK bakiyelidir;
 * düzenleyici (ters) hesapta tersine döner.
 */
export function normalBakiye(h: Pick<TekduzenHesabi, "tur" | "ters">): "B" | "A" {
  const borc = h.tur === "ASSET" || h.tur === "EXPENSE"
  return borc !== h.ters ? "B" : "A"
}
