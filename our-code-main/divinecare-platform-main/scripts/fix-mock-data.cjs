const fs = require('fs');

// 1. Fix src/features/medical/data.ts
let medData = fs.readFileSync('g:/divinecare-platform/src/features/medical/data.ts', 'utf8');
medData = medData.split('Robert Chen').join('Ebony Squire');
medData = medData.split('MED-88219').join('SQUEBO');
medData = medData.split('James " Jim\ Wilson').join('Kamil Brown');
medData = medData.split('James Wilson').join('Kamil Brown');
medData = medData.split('MED-74102').join('BROKAM');
medData = medData.split('r.chen68@gmail.com').join('ebony.squire@gmail.com');
fs.writeFileSync('g:/divinecare-platform/src/features/medical/data.ts', medData, 'utf8');
console.log('Fixed src/features/medical/data.ts');

// 2. Fix src/app/api/medical/billing/charges/route.ts
let chargesRoute = fs.readFileSync('g:/divinecare-platform/src/app/api/medical/billing/charges/route.ts', 'utf8');
chargesRoute = chargesRoute.split('Robert Chen').join('Ebony Squire');
chargesRoute = chargesRoute.split('MED-88219').join('SQUEBO');
fs.writeFileSync('g:/divinecare-platform/src/app/api/medical/billing/charges/route.ts', chargesRoute, 'utf8');
console.log('Fixed src/app/api/medical/billing/charges/route.ts');