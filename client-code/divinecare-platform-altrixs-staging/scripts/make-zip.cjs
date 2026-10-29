const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const filesToInclude = [
  'scripts/repair-valant-import.ts',
  'src/lib/valant/repair.ts',
  'tests/valant-repair-fixtures.test.ts',
  'tests/valant-repair-disposable-integration.test.ts',
  'scripts/import-all-client-data.ts',


  
  'src/features/caseload/algorithms.ts',
  'src/features/caseload/types.ts',
  'src/features/clients/types.ts',
  'src/app/api/clients/[id]/route.ts',
  'src/app/dashboard/ehr/prescriptions/page.tsx',
  'src/app/dashboard/ehr/prescriptions/mock/page.tsx',
  'src/components/drfirst/DrFirstPanel.tsx',
  'src/lib/drfirst/access.ts',
  'src/lib/drfirst/service.ts'
];

const zipPath = path.resolve('valant-code-review.zip');
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Using tar on Windows which creates standard zip
const cmd = `tar -a -cf "${zipPath}" ${filesToInclude.join(' ')}`;
console.log('Running:', cmd);
execSync(cmd, { stdio: 'inherit' });
console.log('Created:', zipPath, 'Size:', fs.statSync(zipPath).size, 'bytes');
