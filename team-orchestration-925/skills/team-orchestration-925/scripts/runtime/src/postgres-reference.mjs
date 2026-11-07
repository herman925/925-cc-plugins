// Persist only the variable name. A resolved connection remains in the native
// process, never in a project file, startup profile, review or status result.
import {refusal} from './errors.mjs';
import {integer} from './validation.mjs';
const invalid=()=>refusal('STORE_CONNECTION_REFERENCE_INVALID','PostgreSQL setup requires one named environment variable and no saved credentials.');
export function postgresReference(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['connectionEnvironment','connectionTimeoutMs'].includes(k)))throw invalid();
 const name=input.connectionEnvironment;
 if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))throw invalid();
 return Object.freeze({connectionEnvironment:name,connectionTimeoutMs:integer(input.connectionTimeoutMs??5000,'connection timeout',{min:1,max:60000})});
}
export function resolvePostgresReference(input,environment=process.env){
 const reference=postgresReference(input),value=environment[reference.connectionEnvironment];
 if(typeof value!=='string'||!value||value.includes('\0')||value.length>16384)throw refusal('STORE_CONNECTION_ENV_MISSING','Configure the PostgreSQL connection variable outside Team Orchestrator on this machine.',{connectionEnvironment:reference.connectionEnvironment});
 let url;try{url=new URL(value);}catch{throw invalid();}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname.length<2||url.hash)throw invalid();
 // A URI host override would make the displayed database identity misleading.
 // Remote connections require authenticated TLS; loopback test clusters may
 // explicitly disable it. Never downgrade or fall back to a local database.
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase());
 for(const key of ['host','hostaddr','port','database','dbname','user','password','ssl','sslmode','sslnegotiation','uselibpqcompat']){
  const values=url.searchParams.getAll(key);
  if(values.length>1||(['host','hostaddr','port','database','dbname','user','password','ssl'].includes(key)&&values.length))throw invalid();
 }
 if(!loopback&&url.searchParams.get('sslmode')!=='verify-full')throw refusal('STORE_TLS_REQUIRED','Hosted PostgreSQL requires sslmode=verify-full in its external connection variable.',{connectionEnvironment:reference.connectionEnvironment});
 return Object.freeze({...reference,connectionString:value,identity:Object.freeze({engine:'postgres',host:url.hostname,port:url.port||'5432',database:url.pathname.slice(1),connectionEnvironment:reference.connectionEnvironment,tls:url.searchParams.get('sslmode')==='verify-full'?'verify-full':'loopback'})});
}
export function postgresConnectionOptions(options){
 if(!options||typeof options!=='object')throw invalid();
 if(!Object.hasOwn(options,'connectionEnvironment'))return options; // Existing in-memory engine API, not a persistence format.
 if(Object.hasOwn(options,'connectionString')||Object.hasOwn(options,'ssl'))throw invalid();
 const resolved=resolvePostgresReference({connectionEnvironment:options.connectionEnvironment,connectionTimeoutMs:options.connectionTimeoutMs});
 const {connectionEnvironment,...rest}=options;
 return {...rest,connectionString:resolved.connectionString,connectionTimeoutMs:resolved.connectionTimeoutMs};
}
