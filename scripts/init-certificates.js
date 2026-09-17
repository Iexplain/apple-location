/**
 * Initialize certificates independently.
 * Usage: node scripts/init-certificates.js
 */
const certs = require('../server/utils/certificates');

console.log('Initializing certificates...\n');
certs.initCertificates();
console.log('\n✓ Certificates ready in server/data/certs/ and server/data/keys/');
console.log('  - CA certificate:  server/data/certs/ca-cert.pem');
console.log('  - Server cert:     server/data/certs/server-cert.pem');
console.log('  - Client cert:     server/data/certs/client-cert.pem');
console.log('  - WLOC cert:       server/data/certs/wloc-cert.pem');
