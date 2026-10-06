'use strict';
// Usage: npm run create-admin -- you@example.com "a-strong-password"
const auth = require('../src/auth');
const { get } = require('../src/db');
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-admin -- <email> <password>'); process.exit(1); }
let u = get('SELECT id FROM users WHERE email=?', email.toLowerCase());
if (!u) u = auth.register({ email, password, name: 'Admin' });
auth.makeAdmin(u.id);
console.log(`Administrator ready: ${email}`);
