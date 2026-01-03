const fs = require('fs');
const path = require('path');

function updateRouteParams(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      updateRouteParams(filePath);
    } else if (file === 'route.ts') {
      let content = fs.readFileSync(filePath, 'utf8');
      let modified = false;
      
      // Replace { params }: { params: { id: string } } with { params }: { params: Promise<{ id: string }> }
      const paramPattern = /\{\s*params\s*\}\s*:\s*\{\s*params:\s*\{([^}]+)\}\s*\}/g;
      
      content = content.replace(paramPattern, (match, paramContent) => {
        modified = true;
        return `{ params }: { params: Promise<{${paramContent}}> }`;
      });
      
      // Update all params.id to await params first
      if (modified) {
        // Find function signatures and update params usage
        const functionPattern = /(export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?)(const\s+\w+\s*=\s*params\.)/g;
        
        content = content.replace(/(export\s+async\s+function\s+\w+\s*\([^)]*\{[\s\S]*?)(params\.\w+)/g, (match, before, paramUsage) => {
          // Check if we already await params in this function
          if (!before.includes('await params')) {
            // Add await params at the beginning of the function
            const functionStart = before.lastIndexOf('{');
            if (functionStart !== -1) {
              return before.slice(0, functionStart + 1) + '\n    const resolvedParams = await params;\n    ' + before.slice(functionStart + 1) + paramUsage.replace('params.', 'resolvedParams.');
            }
          }
          return match;
        });
        
        // Replace all params. with resolvedParams. if we added await
        if (content.includes('const resolvedParams = await params')) {
          content = content.replace(/params\.(\w+)/g, 'resolvedParams.$1');
        }
      }
      
      if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
      }
    }
  }
}

const apiDir = path.join(__dirname, '../app/api');
updateRouteParams(apiDir);
console.log('Done!');

