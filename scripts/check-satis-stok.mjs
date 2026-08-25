/**
 * Satış → stok teşhisi: "sattım ama stok düşmedi" şikâyetini kanıta bağlar.
 *
 *   node scripts/check-satis-stok.mjs [kaç-kayıt]
 *
 * Son satış belgelerini (fiş + fatura) tek tek gezer ve HER KALEM için şunu basar:
 * kalem stok düşürmeli miydi (hizmet mi, reçeteli mi), düştü mü (stock_movements),
 * ne kadar düştü. Stok yazımı fatura ucunda try/catch ile yutulduğu için
 * (app/api/e-donusum/invoices/route.ts "[Stok Hata]") hata sessizdir — belgeden
 * hareket çıkmıyorsa tek görünür iz budur.
 *
 * SALT OKUR; hiçbir şey yazmaz.
 */
import "dotenv/config"
import pg from "pg"

const LIMIT = Number(process.argv[2]) || 12

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error("❌ DIRECT_URL / DATABASE_URL bulunamadı (.env)")
  process.exit(1)
}

// Bağlantı alanları tek tek veriliyor: `connectionString` verilirse `?sslmode=require`
// aşağıdaki rejectUnauthorized:false'u eziyor (bkz. scripts/apply-migration.js).
const p = new URL(url)
const client = new pg.Client({
  host: p.hostname,
  port: Number(p.port) || 5432,
  database: p.pathname.replace(/^\//, "") || "postgres",
  user: decodeURIComponent(p.username),
  password: decodeURIComponent(p.password),
  ssl: { rejectUnauthorized: false },
})

const n = (v) => Number(v ?? 0)
const fmt = (v) => n(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

await client.connect()

const { rows } = await client.query(
  `select i.id, i."invoiceNo", i."isReceipt", i.status, i."companyId", c.name as company,
          -- İKİ AT TIME ZONE şart: kolon naive UTC. Tek çevrim, değeri İstanbul
          -- saati SANIP tekrar çeviriyor ve 3 saat GERİ kaydırıyordu (görünen
          -- saat = gerçek İstanbul saati − 6). Teşhis betiğinde yanlış saat,
          -- "bu belge bugün mü kesilmiş" sorusunu yanlış cevaplatır.
          to_char(i."createdAt" at time zone 'UTC' at time zone 'Europe/Istanbul', 'DD.MM HH24:MI') as t
     from invoices i
     join companies c on c.id = i."companyId"
    where i.type = 'SALES'
    order by i."createdAt" desc
    limit $1`,
  [LIMIT],
)

let suspect = 0

for (const inv of rows) {
  const items = (
    await client.query(
      `select ii."productId", ii.description, ii.quantity,
              pr.name as urun, pr."isService", pr."stockQuantity",
              (select count(*) from product_recipes r
                where r."productId" = pr.id and r."isActive" = true) as recete
         from invoice_items ii
         left join products pr on pr.id = ii."productId"
        where ii."invoiceId" = $1
        order by ii."order"`,
      [inv.id],
    )
  ).rows

  const moves = (
    await client.query(
      `select sm."productId", pr.name as urun, sum(sm.quantity) as qty
         from stock_movements sm
         left join products pr on pr.id = sm."productId"
        where sm.reference = $1
        group by sm."productId", pr.name`,
      [inv.id],
    )
  ).rows
  const movByProduct = new Map(moves.map((m) => [m.productId, n(m.qty)]))

  const tur = inv.isReceipt ? "FİŞ (hızlı satış)" : "FATURA (normal satış)"
  console.log(`\n${inv.invoiceNo}  ${tur}  ${inv.status}  ${inv.t}  — ${inv.company}`)

  for (const it of items) {
    const ad = it.urun ?? `${it.description} (ürün kartı yok)`
    if (!it.productId) {
      console.log(`   ·  ${ad}  ×${fmt(it.quantity)}  → stok BEKLENMEZ (serbest satır)`)
      continue
    }
    if (it.isService) {
      console.log(`   ·  ${ad}  ×${fmt(it.quantity)}  → stok BEKLENMEZ (hizmet)`)
      continue
    }
    if (n(it.recete) > 0) {
      const bilesen = moves.filter((m) => m.productId !== it.productId)
      console.log(
        `   ·  ${ad}  ×${fmt(it.quantity)}  → reçeteli: kendi bakiyesi düşmez,` +
          ` ${bilesen.length} bileşen hareketi`,
      )
      if (bilesen.length === 0) suspect++
      continue
    }
    const dusen = movByProduct.get(it.productId)
    if (dusen == null) {
      suspect++
      console.log(
        `   ✗  ${ad}  ×${fmt(it.quantity)}  → STOK HAREKETİ YOK  (kart: ${fmt(it.stockQuantity)})`,
      )
    } else {
      const beklenen = -n(it.quantity)
      const uyum = Math.abs(dusen - beklenen) < 0.0001 ? "✓" : "⚠ miktar uyuşmuyor"
      if (uyum !== "✓") suspect++
      console.log(
        `   ${uyum === "✓" ? "✓" : "⚠"}  ${ad}  ×${fmt(it.quantity)}  → hareket ${fmt(dusen)}` +
          ` (beklenen ${fmt(beklenen)})  kart: ${fmt(it.stockQuantity)}`,
      )
    }
  }
}

console.log(
  `\n${rows.length} belge tarandı — şüpheli kalem: ${suspect}` +
    (suspect === 0 ? "  (belge → hareket zinciri sağlam)" : "  ↑ yukarıdaki ✗/⚠ satırlarına bak"),
)

// 2) KART = HAREKET TOPLAMI Mİ? --------------------------------------------------------
// adjustWarehouseStock kartı ve hareketi TEK transaction'da yazar; ikisi ayrışıyorsa
// stoğu bu kapıyı kullanmadan değiştiren bir yol var demektir (elle düzeltme dâhil).
const { rows: sapma } = await client.query(
  `select c.name as firma, pr.name as urun, pr."stockQuantity" as kart,
          coalesce(sum(sm.quantity), 0) as hareket
     from products pr
     join companies c on c.id = pr."companyId"
     left join stock_movements sm on sm."productId" = pr.id
    where pr."isService" = false
    group by c.name, pr.id, pr.name, pr."stockQuantity"
   having pr."stockQuantity" <> coalesce(sum(sm.quantity), 0)
    order by abs(pr."stockQuantity" - coalesce(sum(sm.quantity), 0)) desc
    limit 15`,
)
console.log(`\n── Kart ≠ hareket toplamı (${sapma.length} ürün) ──`)
for (const s of sapma) {
  console.log(
    `   ${s.urun}  kart ${fmt(s.kart)}  ≠  hareket ${fmt(s.hareket)}` +
      `  (fark ${fmt(n(s.kart) - n(s.hareket))})  — ${s.firma}`,
  )
}
if (sapma.length === 0) console.log("   yok — kart hep hareketle birlikte yazılmış")

// 3) BAŞKA FİRMANIN DEPOSUNA YAZILMIŞ STOK --------------------------------------------
// Hızlı satış ekranı depoyu İSTEMCİDEN gönderir; firma değişince eski firmanın depo
// id'si state'te kalırsa hareket yanlış depoya düşer (kart yine değişir, depo dökümü
// tutmaz). Normal fatura ekranı depo göndermez, hep varsayılana düşer.
const { rows: yabanci } = await client.query(
  `select pc.name as urun_firma, wc.name as depo_firma, w.name as depo,
          count(*) as satir
     from warehouse_stocks ws
     join warehouses w on w.id = ws."warehouseId"
     join companies wc on wc.id = w."companyId"
     join products pr on pr.id = ws."productId"
     join companies pc on pc.id = pr."companyId"
    where pr."companyId" <> w."companyId"
    group by pc.name, wc.name, w.name`,
)
console.log(`\n── Ürünün firması ≠ deponun firması (${yabanci.length} eşleşme) ──`)
for (const y of yabanci) {
  console.log(`   ${y.satir} satır: "${y.urun_firma}" ürünü → "${y.depo_firma}" / ${y.depo}`)
}
if (yabanci.length === 0) console.log("   yok — her stok kendi firmasının deposunda")

await client.end()
