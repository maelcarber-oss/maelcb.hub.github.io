(() => {
'use strict';
const $=id=>document.getElementById(id);
const C=window.MAELHUB_SUPABASE_CONFIG||{};
const ready=C.url&&C.anonKey&&!String(C.url).includes('PEGA_AQUI')&&!String(C.anonKey).includes('PEGA_AQUI');
const status=$('syncStatus'),account=$('syncAccount'),email=$('syncEmail'),password=$('syncPassword');
const login=$('syncLogin'),register=$('syncRegister'),logout=$('syncLogout'),button=$('syncNow');
const LAST='maelHubLastCloudSync_v1',LOCAL='maelHubLastLocalChange_v1',BACKUP='maelHubBackupBeforeCloudSync_v1';
const OWNER='nexusHubCloudOwner_v1',PENDING='nexusHubPendingSignupEmail_v1';
let client=null,user=null,busy=false;
const say=(s,state='info')=>{if(status){status.textContent=s;status.dataset.state=state;}};
const getData=()=>window.MAELHUB_SYNC_API.getData();
const stamp=()=>String(Date.now());
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const setSynced=()=>{localStorage.setItem(LAST,stamp());localStorage.setItem(LOCAL,stamp());};
const hasContent=d=>['homework','exams','grades','tasks','goals','events','quickNotes','projects','snippets','ideas','tools','songs','playlists','notes','quickLinks'].some(k=>Array.isArray(d[k])&&d[k].length)||(d.profile&&((d.profile.username&&d.profile.username!=='Usuario')||d.profile.city));
const busyState=v=>{busy=v;[login,register,logout,button].forEach(b=>{if(b)b.disabled=v;});};
function renderAuth(session){
  user=session?.user||null;
  if(account){account.querySelectorAll('label').forEach(x=>x.hidden=!!user);if(login)login.hidden=!!user;if(register)register.hidden=!!user;if(logout)logout.hidden=!user;}
  if(user)say('Sesión iniciada. Tus datos están vinculados a esta cuenta.','success');
  else if(ready)say('Inicia sesión o crea una cuenta para sincronizar tus datos.');
}
async function upload(d){
  const {error}=await client.from('maelhub_user_data').upsert({user_id:user.id,data:d,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error)throw error;
  localStorage.setItem(OWNER,user.id);localStorage.removeItem(PENDING);setSynced();say('Sincronización completada. Tus datos están guardados en la nube.','success');
}
async function download(remote){
  // Conserva una copia local antes de sustituirla por los datos de la cuenta.
  localStorage.setItem(BACKUP,JSON.stringify(getData()));
  window.MAELHUB_SYNC_API.setData(remote.data||{});
  localStorage.setItem(OWNER,user.id);localStorage.removeItem(PENDING);
  setSynced();
  say('¡Datos de tu cuenta cargados! Este dispositivo ya tiene tu perfil y tu información.','success');
}
async function fetchRemote(){
  const {data:remote,error}=await client.from('maelhub_user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  return remote;
}
function backupAndStartEmptyForCurrentAccount(){
  // Never mix the previous account's local data with a different account.
  localStorage.setItem(BACKUP,JSON.stringify(getData()));
  window.MAELHUB_SYNC_API.setData({});
  localStorage.setItem(OWNER,user.id);
  localStorage.removeItem(PENDING);
  setSynced();
}
async function reconcileAccountData(remote){
  if(!user)return;
  const owner=localStorage.getItem(OWNER),pendingEmail=normalizeEmail(localStorage.getItem(PENDING));
  const pendingMatches=!!pendingEmail&&pendingEmail===normalizeEmail(user.email);
  const local=getData();
  if(remote){
    // A different device or a different account: restore this account's cloud copy.
    if(owner!==user.id){await download(remote);return;}
    const last=Number(localStorage.getItem(LAST)||0),localAt=Number(localStorage.getItem(LOCAL)||0);
    if(!last){
      if(hasContent(local)){
        if(confirm('Esta cuenta ya tiene datos en la nube y este dispositivo también tiene información.\n\nAceptar: guardar los datos de este dispositivo en la nube.\nCancelar: cargar los datos de la cuenta.'))await upload(local);
        else await download(remote);
      }else await download(remote);
      return;
    }
    const localChanged=localAt>last,cloudChanged=new Date(remote.updated_at).getTime()>last;
    if(localChanged&&cloudChanged){
      if(confirm('Hay cambios en este dispositivo y en la nube.\n\nAceptar: guardar los datos de este dispositivo.\nCancelar: cargar la versión de la nube.'))await upload(local);
      else await download(remote);
    }else if(localChanged)await upload(local);
    else if(cloudChanged)await download(remote);
    else say('Todo está sincronizado. Tus datos están disponibles en este dispositivo.','success');
    return;
  }
  // First login after a sign-up that required email confirmation, or same account
  // whose cloud record has not yet been created.
  if(owner===user.id||pendingMatches){
    if(hasContent(local))await upload(local);
    else{
      localStorage.setItem(OWNER,user.id);localStorage.removeItem(PENDING);setSynced();
      say('Cuenta lista. Todavía no hay datos guardados; lo que añadas se sincronizará con esta cuenta.','success');
    }
    return;
  }
  // This browser previously belonged to another account: preserve a backup locally,
  // but never upload that account's information to the new account.
  if(owner&&owner!==user.id){
    backupAndStartEmptyForCurrentAccount();
    say('Esta cuenta aún no tiene datos. La información de la cuenta anterior se ha separado y guardado en una copia local.','success');
    return;
  }
  // Legacy installation without ownership metadata: ask before associating local data.
  if(hasContent(local)){
    if(confirm('Este dispositivo tiene datos guardados y esta cuenta aún no tiene datos en la nube. ¿Quieres guardar aquí los datos de este dispositivo en esta cuenta?'))await upload(local);
    else{
      backupAndStartEmptyForCurrentAccount();
      say('Cuenta lista. Los datos anteriores se han guardado en una copia local y no se han mezclado.','success');
    }
    return;
  }
  localStorage.setItem(OWNER,user.id);localStorage.removeItem(PENDING);setSynced();
  say('Cuenta lista. Todavía no hay datos guardados; lo que añadas se sincronizará con esta cuenta.','success');
}
async function syncAfterAuthentication(){if(!user)return;const remote=await fetchRemote();await reconcileAccountData(remote)}
async function sync(){
  if(!ready||!client){say('Falta conectar Supabase. Revisa sync-config.js.','error');return;}
  if(!user){say('Primero inicia sesión o crea una cuenta.','error');return;}
  if(busy)return;
  busyState(true);
  try{const remote=await fetchRemote();await reconcileAccountData(remote)}
  catch(e){console.error('NEXUS HUB sync',e);say('No se pudo sincronizar: '+(e.message||'error desconocido')+'. Comprueba la conexión y los permisos de Supabase.','error');}
  finally{busyState(false);}
}
if(!ready){
  say('Falta configurar Supabase. Añade la URL y la clave pública del proyecto en sync-config.js.','error');
  if(button)button.disabled=true;
}else if(!window.supabase?.createClient){
  say('No se pudo cargar el cliente de sincronización. Comprueba tu conexión.','error');
}else{
  client=window.supabase.createClient(C.url,C.anonKey);
  client.auth.getSession().then(async({data,error})=>{if(error)throw error;renderAuth(data.session);if(data.session?.user){busyState(true);try{await syncAfterAuthentication()}catch(e){say('No se pudieron cargar los datos de la cuenta: '+e.message,'error')}finally{busyState(false)}}}).catch(e=>say('Error al comprobar la sesión: '+e.message,'error'));
  client.auth.onAuthStateChange((_event,session)=>renderAuth(session));
}
if(register)register.addEventListener('click',async()=>{
  if(!client){say('No se puede conectar con el servicio de cuentas. Comprueba la conexión.','error');return;}
  const address=normalizeEmail(email.value);
  if(!address||password.value.length<8){say('Escribe un correo válido y una contraseña de al menos 8 caracteres.','error');return;}
  busyState(true);
  try{
    const {data,error}=await client.auth.signUp({email:address,password:password.value});
    if(error)throw error;
    // A new account must never inherit another account's local information.
    if(localStorage.getItem(OWNER)||localStorage.getItem(LAST)){
      localStorage.setItem(BACKUP,JSON.stringify(getData()));
      window.MAELHUB_SYNC_API.setData({});
      localStorage.removeItem(OWNER);localStorage.removeItem(LAST);localStorage.removeItem(LOCAL);
    }
    localStorage.setItem(PENDING,address);
    if(data.session){
      renderAuth(data.session);
      await syncAfterAuthentication();
    }else{
      say('Cuenta creada. Revisa el correo para confirmar la dirección una sola vez. Después podrás iniciar sesión con este mismo correo y contraseña en cualquier dispositivo.','success');
    }
    password.value='';
  }catch(e){say('No se pudo crear la cuenta: '+(e.message||'error desconocido'),'error');}
  finally{busyState(false);}
});
if(login)login.addEventListener('click',async()=>{
  if(!client){say('No se puede conectar con el servicio de cuentas. Comprueba la conexión.','error');return;}
  const address=normalizeEmail(email.value);
  if(!address||!password.value){say('Introduce tu correo y contraseña.','error');return;}
  busyState(true);
  try{
    const {data,error}=await client.auth.signInWithPassword({email:address,password:password.value});
    if(error)throw error;
    renderAuth(data.session);
    await syncAfterAuthentication();
    password.value='';
  }catch(e){say('No se pudo iniciar sesión: '+(e.message||'error desconocido'),'error');}
  finally{busyState(false);}
});
if(logout)logout.addEventListener('click',async()=>{
  if(!client)return;
  busyState(true);
  try{const {error}=await client.auth.signOut();if(error)throw error;renderAuth(null);say('Sesión cerrada. Los datos locales permanecen guardados en este dispositivo.','success');}
  catch(e){say('No se pudo cerrar sesión: '+e.message,'error');}
  finally{busyState(false);}
});
if(button)button.addEventListener('click',sync);
window.addEventListener('maelhub:datachange',()=>{
  localStorage.setItem(LOCAL,stamp());
  if(user&&status?.dataset.state==='success')say('Hay cambios locales pendientes. Pulsa «Sincronizar ahora» para subirlos.');
});
})();