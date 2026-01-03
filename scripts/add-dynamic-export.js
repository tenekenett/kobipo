const fs = require('fs');
const path = require('path');

function addDynamicExport(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      addDynamicExport(filePath);
    } else if (file === 'route.ts') {
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Skip if already has dynamic export
      if (content.includes("export const dynamic")) {
        continue;
      }
      
      // Find the last import statement
      const importRegex = /(import\s+.*?from\s+['"].*?['"];?\s*\n)+/g;
      const matches = content.match(importRegex);
      
      if (matches) {
        const lastImport = matches[matches.length - 1];
        const lastImportIndex = content.lastIndexOf(lastImport);
        const insertIndex = lastImportIndex + lastImport.length;
        
        content = content.slice(0, insertIndex) + 
                  "\nexport const dynamic = 'force-dynamic'\n" + 
                  content.slice(insertIndex);
        
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Added dynamic export to: ${filePath}`);
      }
    }
  }
}

const apiDir = path.join(__dirname, '../app/api');
addDynamicExport(apiDir);
console.log('Done!');

