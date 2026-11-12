(() => {
'use strict';
const $=id=>document.getElementById(id);
const C=window.MAELHUB_SUPABASE_CONFIG||{};
const ready=C.url&&C.anonKey&&!String(C.url).includes('PEGA_AQUI')&&!String(C.anonKey).includes('PEGA_AQUI');
const status=$('syncStatus'),account=$('syncAccount'),email=$('syncEmail'),password=$('syncPassword');
const login=$('syncLogin'),register=$('syncRegister'),logout=$('syncLogout'),button=$('syncNow');
const LAST='maelHubLastCloudSync_v1',LOCAL='maelHubLastLocalChange_v1',BACKUP='maelHubBackupBeforeCloudSync_v1';
let client=null,user=null,busy=false;
const say=(s,state='info')=>{if(status){status.textContent=s;status.dataset.state=state;}};
const getData=()=>window.MAELHUB_SYNC_API.getData();
const stamp=()=>String(Date.now());
const setSynced=()=>{localStorage.setItem(LAST,stamp());localStorage.setItem(LOCAL,stamp());};
const hasContent=d=>['homework','exams','grades','tasks','goals','events','quickNotes','projects','snippets','ideas','tools','songs','playlists','notes','quickLinks'].some(k=>Array.isArray(d[k])&&d[k].length)||(d.profile&&((d.profile.username&&d.profile.username!=='Usuario')||d.profile.city));
const busyState=v=>{busy=v;[login,register,logout,button].forEach(b=>{if(b)b.disabled=v;});};
function renderAuth(session){
  user=session?.user||null;
  if(account){account.querySelectorAll('label').forEach(x=>x.hidden=!!user);if(login)login.hidden=!!user;if(register)register.hidden=!!user;if(logout)logout.hidden=!user;}
  if(user)say('Sesión iniciada: '+user.email+'. Tus datos se sincronizan con esta cuenta.','success');
  else if(ready)say('Inicia sesión o crea una cuenta para sincronizar tus datos.');
}
async function upload(d){
  const {error}=await client.from('maelhub_user_data').upsert({user_id:user.id,data:d,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error)throw error;
  setSynced();say('Sincronización completada. Tus datos están guardados en la nube.','success');
}
async function download(remote){
  // Conserva una copia local antes de sustituirla por los datos de la cuenta.
  localStorage.setItem(BACKUP,JSON.stringify(getData()));
  window.MAELHUB_SYNC_API.setData(remote.data||{});
  setSynced();
  say('¡Datos de tu cuenta cargados! Este dispositivo ya tiene tu perfil y tu información.','success');
}
async function fetchRemote(){
  const {data:remote,error}=await client.from('maelhub_user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  return remote;
}
async function syncAfterAuthentication(isNewAccount=false){
  if(!user)return;
  const remote=await fetchRemote();
  if(remote){
    await download(remote);
    return;
  }
  const local=getData();
  if(hasContent(local)){
    await upload(local);
    say(isNewAccount?'Cuenta creada y perfil guardado en la nube. Ya puedes iniciar sesión desde otros dispositivos.':'Esta cuenta todavía no tenía datos. Se ha guardado aquí el perfil de este dispositivo.','success');
  }else{
    say('La cuenta está lista. Todavía no hay datos guardados en la nube.','success');
  }
}
async function sync(){
  if(!ready||!client){say('Falta conectar Supabase. Revisa sync-config.js.','error');return;}
  if(!user){say('Primero inicia sesión o crea una cuenta.','error');return;}
  if(busy)return;
  busyState(true);
  try{
    const remote=await fetchRemote(),local=getData();
    if(!remote){if(hasContent(local))await upload(local);else say('No hay datos locales para guardar.','info');return;}
    const last=Number(localStorage.getItem(LAST)||0),localAt=Number(localStorage.getItem(LOCAL)||0);
    if(!last){if(hasContent(local)){if(confirm('Hay datos en este dispositivo y en la nube.\n\nAceptar: subir los datos de este dispositivo.\nCancelar: descargar los datos de la nube y sustituir los locales.'))await upload(local);else await download(remote);}else await download(remote);return;}
    const localChanged=localAt>last,cloudChanged=new Date(remote.updated_at).getTime()>last;
    if(localChanged&&cloudChanged){if(confirm('Hay cambios en este dispositivo y en la nube.\n\nAceptar: subir los datos de este dispositivo y reemplazar la versión de la nube.\nCancelar: descargar la versión de la nube y reemplazar los datos locales.'))await upload(local);else await download(remote);}
    else if(localChanged)await upload(local);
    else if(cloudChanged)await download(remote);
    else say('Todo está sincronizado. No hay cambios pendientes.','success');
  }catch(e){console.error('NEXUS HUB sync',e);say('No se pudo sincronizar: '+(e.message||'error desconocido')+'. Comprueba la conexión y los permisos de Supabase.','error');}
  finally{busyState(false);}
}
if(!ready){
  say('Falta configurar Supabase. Añade la URL y la clave pública del proyecto en sync-config.js.','error');
  if(button)button.disabled=true;
}else if(!window.supabase?.createClient){
  say('No se pudo cargar el cliente de sincronización. Comprueba tu conexión.','error');
}else{
  client=window.supabase.createClient(C.url,C.anonKey);
  client.auth.getSession().then(({data,error})=>{if(error)throw error;renderAuth(data.session);}).catch(e=>say('Error al comprobar la sesión: '+e.message,'error'));
  client.auth.onAuthStateChange((_event,session)=>renderAuth(session));
}
if(register)register.addEventListener('click',async()=>{
  if(!client){say('Configura Supabase antes de crear una cuenta.','error');return;}
  if(!email.value.trim()||password.value.length<8){say('Introduce un correo y una contraseña de al menos 8 caracteres.','error');return;}
  busyState(true);
  try{
    const {data,error}=await client.auth.signUp({email:email.value.trim(),password:password.value});
    if(error)throw error;
    if(data.session){
      renderAuth(data.session);
      await syncAfterAuthentication(true);
    }else{
      say('Cuenta creada. Confirma el correo desde tu bandeja de entrada y después inicia sesión en este dispositivo.','success');
    }
  }catch(e){say('No se pudo crear la cuenta: '+(e.message||'error desconocido'),'error');}
  finally{busyState(false);}
});
if(login)login.addEventListener('click',async()=>{
  if(!client){say('Configura Supabase antes de iniciar sesión.','error');return;}
  if(!email.value.trim()||!password.value){say('Introduce tu correo y contraseña.','error');return;}
  busyState(true);
  try{
    const {data,error}=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value});
    if(error)throw error;
    renderAuth(data.session);
    await syncAfterAuthentication(false);
  }catch(e){say('No se pudo iniciar sesión: '+(e.message||'error desconocido'),'error');}
  finally{busyState(false);}
});
if(logout)logout.addEventListener('click',async()=>{
  if(!client)return;
  busyState(true);
  try{const {error}=await client.auth.signOut();if(error)throw error;renderAuth(null);say('Sesión cerrada. Los datos locales permanecen en este dispositivo.','success');}
  catch(e){say('No se pudo cerrar sesión: '+e.message,'error');}
  finally{busyState(false);}
});
if(button)button.addEventListener('click',sync);
window.addEventListener('maelhub:datachange',()=>{
  localStorage.setItem(LOCAL,stamp());
  if(user&&status?.dataset.state==='success')say('Hay cambios locales pendientes. Pulsa «Sincronizar ahora» para subirlos.');
});
})();