import { randomBytes, pbkdf2Sync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node backend/scripts/hash-password.mjs "password"');
  process.exit(1);
}

const iterations = 100000;
const salt = randomBytes(16).toString('base64url');
const saltBytes = Buffer.from(salt.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((salt.length + 3) % 4), 'base64');
const hash = pbkdf2Sync(password, saltBytes, iterations, 32, 'sha256').toString('base64url');
console.log(`pbkdf2$${iterations}$${salt}$${hash}`);
