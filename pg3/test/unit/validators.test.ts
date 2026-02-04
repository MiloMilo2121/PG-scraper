
import { Validators } from '../../src/utils/validators';
import { strict as assert } from 'assert';

console.log('🧪 Testing Validators...');

// PIVA Test
const piva = Validators.extractPIVA('La nostra azienda IT12345678901 opera in...');
assert.equal(piva, 'IT12345678901', 'Should extract IT PIVA');
console.log('  ✅ PIVA Extraction');

// Phone Test
const phone = Validators.formatPhone('333 1234567');
assert.equal(phone, '+393331234567', 'Should format mobile');
console.log('  ✅ Phone Formatting');

// Language Test
const isIt = Validators.isItalian('Questa è una frase di prova per la lingua.');
assert.equal(isIt, true, 'Should detect Italian');
console.log('  ✅ Language Detection');

console.log('✨ Validators Tests Passed!');
