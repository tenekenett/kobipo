#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runMigration() {
  const migrationFile = path.join(__dirname, '../supabase/migrations/20240101000000_initial_schema.sql');
  const sql = fs.readFileSync(migrationFile, 'utf-8');

  // DATABASE_URL'den connection bilgilerini parse et
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable bulunamadı!');
    process.exit(1);
  }

  // Connection string'i parse et
  // postgresql://postgres:password@host:port/database formatını parse et
  const match = databaseUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!match) {
    console.error('❌ DATABASE_URL formatı geçersiz!');
    process.exit(1);
  }
  
  const [, user, password, host, port, database] = match;
  
  const client = new Client({
    host: host,
    port: parseInt(port) || 5432,
    database: database,
    user: user,
    password: decodeURIComponent(password),
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Veritabanına bağlanılıyor...');
    await client.connect();
    console.log('✅ Bağlantı başarılı!');
    
    console.log('🔄 Migration çalıştırılıyor...');
    await client.query(sql);
    console.log('✅ Migration başarıyla tamamlandı!');
    
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Hata:', error.message);
    await client.end();
    process.exit(1);
  }
}

runMigration();

