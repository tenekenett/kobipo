const fs = require('fs');
const path = require('path');

const files = [
  'app/api/cari/customers/[id]/route.ts',
  'app/api/cari/suppliers/[id]/route.ts',
  'app/api/companies/[id]/route.ts',
  'app/api/e-donusum/invoices/[id]/route.ts',
  'app/api/finans/accounts/[id]/route.ts',
  'app/api/stok/products/[id]/route.ts',
];

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix: Replace { params: { id: string } } with Promise version
  content = content.replace(
    /\{\s*params\s*\}\s*:\s*\{\s*params:\s*\{\s*id:\s*string\s*\}\s*\}/g,
    '{ params }: { params: Promise<{ id: string }> }'
  );
  
  // Fix: Add await params at the start of each function, before first params usage
  content = content.replace(
    /(export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?)(\s+const\s+\w+\s*=\s*await\s+prisma\.\w+\.findUnique\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*)params\.id/g,
    (match, before, after) => {
      // Check if resolvedParams already exists
      if (!before.includes('resolvedParams')) {
        return before + '\n    const resolvedParams = await params\n' + after + 'resolvedParams.id';
      }
      return match;
    }
  );
  
  // Replace all remaining params.id with resolvedParams.id
  content = content.replace(/params\.id/g, 'resolvedParams.id');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed: ${filePath}`);
});

console.log('Done!');

