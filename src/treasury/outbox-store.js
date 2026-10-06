import { TreasuryError } from './runtime-contract.js';

// Every read/modify/write is one IndexedDB transaction, including lease acquisition.
// No credentials, session tokens or user profiles are stored in this database.
export function createIndexedDbOutbox({ indexedDB = globalThis.indexedDB, scope = '/domus-3/' } = {}) {
  if(!scope.startsWith('/')||!scope.endsWith('/'))throw new TreasuryError('INVALID_PAYLOAD');
  const open=()=>new Promise((resolve,reject)=>{
    if(!indexedDB)return reject(new TreasuryError('STORAGE_UNAVAILABLE'));
    const request=indexedDB.open('domus3-treasury-outbox:'+scope,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('operations',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=request.onblocked=()=>reject(new TreasuryError('STORAGE_UNAVAILABLE'));
  });
  async function transact(id, mutate) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      let value,failure;
      const tx=db.transaction('operations',mutate?'readwrite':'readonly'),store=tx.objectStore('operations');
      const request=id==null?store.getAll():store.get(id);
      request.onsuccess=()=>{try{value=mutate?mutate(structuredClone(request.result)):request.result;if(mutate&&value!==undefined)store.put(value);}catch(error){failure=error;tx.abort();}};
      tx.oncomplete=()=>{db.close();resolve(structuredClone(value));};
      tx.onabort=tx.onerror=()=>{db.close();reject(failure||new TreasuryError('STORAGE_UNAVAILABLE'));};
    });
  }
  return Object.freeze({list:()=>transact(null),get:id=>transact(id),update:(id,fn)=>transact(id,fn)});
}
