import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const line=prefix=>html.split('\n').find(s=>s.startsWith(prefix));
function fixture() {
  const elements=new Map(),messages=[];
  const element=id=>{if(!elements.has(id)){const hidden=new Set();elements.set(id,{value:'',disabled:false,classList:{add:s=>hidden.add(s),remove:s=>hidden.delete(s),contains:s=>hidden.has(s)}});}return elements.get(id);};
  const context={user:{id:'a'},session:null,passwordRecoveryMode:true,recoveryUserId:'a',recoverySaving:false,
    document:{getElementById:element},msg:(_id,text)=>messages.push(text),setBusy:(el,b)=>el.disabled=b,
    friendlyAuthError:s=>s,routeBySession:async()=>{},sb:{auth:{}},window:{DOMUSTreasury3:{reset(){}}},setTimeout(){},
    history:{replaceState(){}},location:{pathname:'/domus-3/index.html'}};
  return {context,element,messages};
}
function submitFixture(){const f=fixture();runInNewContext(line("document.getElementById('passwordRecoveryForm').onsubmit="),f.context);f.element('recoveryPassword').value='Ficticia-segura-123';f.element('recoveryPasswordConfirm').value='Ficticia-segura-123';f.submit=()=>f.element('passwordRecoveryForm').onsubmit({preventDefault(){}});return f;}

test('recuperación rechaza una sesión ausente o de otro usuario antes de actualizar',async()=>{
  for(const user of [null,{id:'b'}]){const f=submitFixture();f.context.user=user;f.context.sb.auth.updateUser=()=>assert.fail('unexpected update');await f.submit();assert.match(f.messages.at(-1),/no es válido o ha caducado/);}
});
test('recuperación evita doble envío y limpia formulario e identidad al completarse',async()=>{
  const f=submitFixture();let finish,calls=0;
  f.context.sb.auth.updateUser=()=>{calls++;return new Promise(resolve=>finish=resolve);};
  const pending=f.submit();await f.submit();assert.equal(calls,1);assert.equal(f.element('recoveryPasswordSubmit').disabled,true);
  finish({data:{user:{id:'a'}},error:null});await pending;
  assert.equal(f.context.passwordRecoveryMode,false);assert.equal(f.context.recoveryUserId,null);
  assert.equal(f.element('recoveryPassword').value,'');assert.equal(f.element('recoveryPasswordConfirm').value,'');assert.equal(f.context.recoverySaving,false);
});
test('un error del servidor permite reintentar sin abandonar recuperación',async()=>{
  const f=submitFixture();f.context.sb.auth.updateUser=async()=>({error:new Error('Fallo simulado')});await f.submit();
  assert.equal(f.context.passwordRecoveryMode,true);assert.equal(f.context.recoverySaving,false);assert.equal(f.element('recoveryPasswordSubmit').disabled,false);assert.equal(f.messages.at(-1),'Fallo simulado');
});
test('la carga de membresía pendiente no oculta PASSWORD_RECOVERY ni publica otra sesión',async()=>{
  for(const change of [c=>c.passwordRecoveryMode=true,c=>c.user={id:'b'}]) {
    const f=fixture();f.context.passwordRecoveryMode=false;let finish;const shown=[];
    f.context.loadMembership=()=>new Promise(resolve=>finish=resolve);f.context.showOnly=s=>shown.push(s);
    runInNewContext(line('async function routeBySession()'),f.context);
    const pending=f.context.routeBySession();change(f.context);finish({household:{id:'h'}});await pending;assert.deepEqual(shown,[]);
  }
});
test('cerrar o cambiar sesión durante recuperación limpia su estado y contraseñas',async()=>{
  for(const next of [null,{user:{id:'b'}}]) {
    const f=fixture();let callback;f.context.sb.auth.onAuthStateChange=fn=>callback=fn;f.context.sb.auth.getSession=async()=>({data:{session:{user:{id:'a'}}}});
    f.element('recoveryPassword').value='no-conservar';f.element('recoveryPasswordConfirm').value='no-conservar';
    await runInNewContext(line('async function boot()')+';boot()',f.context);
    callback(next?'SIGNED_IN':'SIGNED_OUT',next);
    assert.equal(f.context.passwordRecoveryMode,false);assert.equal(f.context.recoveryUserId,null);assert.equal(f.element('recoveryPassword').value,'');assert.equal(f.element('recoveryPasswordConfirm').value,'');
  }
});
test('los errores al solicitar recuperación no exponen mensajes de existencia de cuentas',async()=>{
  const f=fixture();f.element('authEmail').value='test@example.invalid';
  f.context.sb.auth.resetPasswordForEmail=async()=>({error:new Error('User not found: private backend detail')});
  runInNewContext(line("document.getElementById('forgotPasswordBtn').onclick="),f.context);
  await f.element('forgotPasswordBtn').onclick();
  assert.equal(f.messages.at(-1),'No se pudo completar la solicitud. Inténtalo de nuevo más tarde.');
  assert.equal(f.element('forgotPasswordBtn').disabled,false);
});
