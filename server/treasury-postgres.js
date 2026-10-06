import {identity,fail,TreasuryError} from '../src/treasury/runtime-contract.js';

// node-postgres compatible pool injection. A checked-out connection is used for
// BEGIN, role/actor setup, EVERY query, COMMIT/ROLLBACK, then released exactly once.
// Do not pass an anonymous/public Data API client here. No connection is opened at import.
export function createPostgresTransaction({pool}){
  if(typeof pool?.connect!=='function')fail('INVALID_PAYLOAD');
  return async(session,work)=>{
    const actor=identity(session?.userId),client=await pool.connect();let begun=false,discard,committing=false;
    try{
      await client.query('BEGIN');begun=true;
      await client.query('SET LOCAL ROLE domus_treasury_executor');
      const role=(await client.query('select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
      if(role?.name!=='domus_treasury_executor'||role.rolsuper||role.rolbypassrls)fail('UNAUTHORIZED');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      const result=await work(Object.freeze({query:(sql,params)=>client.query(sql,params)}));
      committing=true;await client.query('COMMIT');begun=false;return result;
    }catch(error){
      if(begun){try{await client.query('ROLLBACK');}catch(rollbackError){discard=rollbackError;}}
      else discard=error;
      if(committing&&!/^2[23]/.test(error?.code||''))throw new TreasuryError('BACKEND_UNAVAILABLE');
      throw error;
    }finally{client.release(discard);}
  };
}
