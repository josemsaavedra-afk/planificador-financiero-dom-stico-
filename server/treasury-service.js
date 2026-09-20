import {createAuthVerifier,createTreasuryHttpHandler} from './treasury-http.js';
import {createPostgresTransaction} from './treasury-postgres.js';

// Host integration entry point; construction does not connect, listen or activate.
export function createTreasuryService({enabled=false,origin,authClient,pool}){
  return createTreasuryHttpHandler({enabled,origin,
    authenticate:createAuthVerifier({authClient}),
    transaction:createPostgresTransaction({pool})
  });
}
