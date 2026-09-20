// No network access. The harness refuses remote hosts and non-test databases.
export function isolatedPgTarget(raw, confirmation) {
  let url;try{url=new URL(raw);}catch{throw Error('DATABASE_URL aislada no válida');}
  const database=decodeURIComponent(url.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||!/^domus_test_[a-z0-9_]+$/.test(database)||confirmation!==database)throw Error('Se requiere PostgreSQL loopback, base domus_test_* vacía y confirmación explícita de su nombre');
  return {PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port||'5432',PGDATABASE:database,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password)};
}
