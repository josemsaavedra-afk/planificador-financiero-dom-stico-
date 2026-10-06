import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('ofrece recuperación de contraseña desde el acceso', () => {
  assert.match(html, /id="forgotPasswordBtn"/);
  assert.match(html, /resetPasswordForEmail\(email,\{redirectTo:authRedirectUrl\(\)\}\)/);
});

test('procesa el evento seguro de recuperación y actualiza la contraseña', () => {
  assert.match(html, /event==='PASSWORD_RECOVERY'/);
  assert.match(html, /sb\.auth\.updateUser\(\{password\}\)/);
  assert.match(html, /password\.length<8/);
  assert.match(html, /password!==confirmation/);
});

test('la respuesta no revela si el correo está registrado', () => {
  assert.match(html, /Si el correo pertenece a una cuenta/);
  assert.doesNotMatch(html, /jenifermontalban7@gmail\.com/i);
  assert.doesNotMatch(html, /service_role/i);
});
