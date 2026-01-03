#!/usr/bin/env node

/**
 * Prisma Schema'dan Supabase Migration Oluşturma Yardımcı Scripti
 * 
 * Bu script, Prisma schema değişikliklerini Supabase migration formatına dönüştürmenize yardımcı olur.
 * 
 * Kullanım:
 * 1. Prisma schema'yı değiştirin
 * 2. npm run db:migrate ile Prisma migration oluşturun
 * 3. Bu script'i çalıştırın: node scripts/sync-prisma-to-supabase.js
 * 4. Oluşturulan SQL dosyasını kontrol edin ve supabase/migrations/ klasörüne taşıyın
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRISMA_MIGRATIONS_DIR = path.join(__dirname, '../prisma/migrations');
const SUPABASE_MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

function getLatestPrismaMigration() {
  try {
    const migrations = fs.readdirSync(PRISMA_MIGRATIONS_DIR)
      .filter(dir => {
        const dirPath = path.join(PRISMA_MIGRATIONS_DIR, dir);
        return fs.statSync(dirPath).isDirectory();
      })
      .sort()
      .reverse();

    if (migrations.length === 0) {
      console.log('❌ Prisma migration bulunamadı.');
      return null;
    }

    return migrations[0];
  } catch (error) {
    console.error('❌ Prisma migrations klasörü okunamadı:', error.message);
    return null;
  }
}

function getMigrationSQL(migrationDir) {
  const migrationPath = path.join(PRISMA_MIGRATIONS_DIR, migrationDir);
  const migrationFile = path.join(migrationPath, 'migration.sql');

  if (!fs.existsSync(migrationFile)) {
    console.log('❌ migration.sql dosyası bulunamadı:', migrationFile);
    return null;
  }

  return fs.readFileSync(migrationFile, 'utf-8');
}

function createSupabaseMigration(sql, migrationName) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const fileName = `${timestamp}_${migrationName}.sql`;
  const filePath = path.join(SUPABASE_MIGRATIONS_DIR, fileName);

  // SQL'i Supabase formatına uygun hale getir
  let supabaseSQL = sql
    // IF NOT EXISTS ekle
    .replace(/CREATE TABLE "(\w+)"/g, 'CREATE TABLE IF NOT EXISTS "$1"')
    .replace(/CREATE INDEX "(\w+)"/g, 'CREATE INDEX IF NOT EXISTS "$1"')
    .replace(/CREATE UNIQUE INDEX "(\w+)"/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "$1"')
    // DROP CONSTRAINT IF EXISTS ekle
    .replace(/ALTER TABLE "(\w+)" DROP CONSTRAINT "(\w+)"/g, 
      'ALTER TABLE "$1" DROP CONSTRAINT IF EXISTS "$2"')
    // AddForeignKey için IF EXISTS kontrolü ekle
    .replace(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" FOREIGN KEY/g,
      'ALTER TABLE "$1" DROP CONSTRAINT IF EXISTS "$2";\nALTER TABLE "$1" ADD CONSTRAINT "$2" FOREIGN KEY');

  fs.writeFileSync(filePath, supabaseSQL, 'utf-8');
  console.log(`✅ Supabase migration oluşturuldu: ${fileName}`);
  return fileName;
}

function main() {
  console.log('🔄 Prisma migration\'ı Supabase migration\'a dönüştürülüyor...\n');

  const latestMigration = getLatestPrismaMigration();
  if (!latestMigration) {
    return;
  }

  console.log(`📦 En son Prisma migration: ${latestMigration}\n`);

  const sql = getMigrationSQL(latestMigration);
  if (!sql) {
    return;
  }

  // Migration adını al (timestamp olmadan)
  const migrationName = latestMigration.split('_').slice(1).join('_') || 'prisma_migration';

  const fileName = createSupabaseMigration(sql, migrationName);
  
  console.log(`\n✅ Tamamlandı!`);
  console.log(`📝 Oluşturulan dosya: supabase/migrations/${fileName}`);
  console.log(`\n⚠️  Lütfen oluşturulan SQL dosyasını kontrol edin ve gerekirse düzenleyin.`);
  console.log(`💡 Migration'ı uygulamak için: npm run supabase:db:push`);
}

if (require.main === module) {
  main();
}

module.exports = { main };

