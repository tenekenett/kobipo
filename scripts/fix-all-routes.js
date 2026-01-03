const fs = require('fs');
const path = require('path');

const files = [
  'app/api/cari/suppliers/[id]/route.ts',
  'app/api/companies/[id]/route.ts',
  'app/api/e-donusum/invoices/[id]/route.ts',
  'app/api/finans/accounts/[id]/route.ts',
  'app/api/stok/products/[id]/route.ts',
];

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix params type
  content = content.replace(
    /\{\s*params\s*\}\s*:\s*\{\s*params:\s*\{\s*id:\s*string\s*\}\s*\}/g,
    '{ params }: { params: Promise<{ id: string }> }'
  );
  
  // Fix: Move resolvedParams declaration before first usage
  content = content.replace(
    /(\s+const\s+\w+\s*=\s*await\s+prisma\.\w+\.findUnique\(\s*\{[\s\S]*?where:\s*\{[\s\S]*?)(const\s+resolvedParams\s*=\s*await\s+params;[\s\S]*?id:\s*)resolvedParams\.id/g,
    (match, before, after) => {
      return before.replace(/where:\s*\{[\s\S]*?id:\s*params\.id/, '') + '\n    const resolvedParams = await params\n    const ' + before.match(/const\s+(\w+)/)[1] + ' = await prisma.' + before.match(/prisma\.(\w+)/)[1] + '.findUnique({\n      where: { id: resolvedParams.id';
    }
  );
  
  // Fix: Add resolvedParams if missing
  content = content.replace(
    /(export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(!user\)\s*\{[\s\S]*?return\s+NextResponse\.json\([^}]*\}\s*\{[^}]*\}\s*\)[\s\S]*?\})(\s+const\s+\w+\s*=\s*await\s+prisma\.\w+\.findUnique\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*)params\.id/g,
    (match, before, after) => {
      if (!before.includes('resolvedParams')) {
        return before + '\n    const resolvedParams = await params' + after + 'resolvedParams.id';
      }
      return match;
    }
  );
  
  // Replace all params.id with resolvedParams.id
  content = content.replace(/params\.id/g, 'resolvedParams.id');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed: ${filePath}`);
});

console.log('Done!');

