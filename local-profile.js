(() => {
  'use strict';

  // Offline profiles: no email, backend account, or cloud sync.
  // Data is encrypted with AES-GCM; the password is never stored.
  const PROFILES_KEY = 'nexusHubLocalProfiles_v1';
  const REMEMBERED_ID = 'nexusHubRememberedProfile_v1';
  const LEGACY_KEY = 'maelHubData_v1';
  const ACTIVE_KEY = 'nexusHubActiveSessionData_v1';
  const DB_NAME = 'nexusHubLocalKeys_v1';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let mode = 'create';
  let current = null;
  let writeQueue = Promise.resolve();

  const $ = id => document.getElementById(id);
  const bytesToB64 = bytes => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };
  const b64ToBytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  const normalize = value => String(value || '').trim().toLowerCase();

  function getProfiles() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error('El archivo de perfiles locales está dañado. No se ha borrado ningún dato.');
    }
  }

  function saveProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  function setMessage(text, type = '') {
    const target = $('localAuthMessage');
    target.textContent = text;
    target.className = 'local-auth-message ' + type;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const creating = mode === 'create';
    $('localAuthTitle').textContent = creating ? 'Crea tu perfil' : 'Bienvenido de nuevo';
    $('localAuthDescription').textContent = creating
      ? 'Crea un usuario y una contraseña para proteger tu espacio personal en este dispositivo.'
      : 'Introduce tu usuario y contraseña para abrir tu espacio personal.';
    $('localAuthConfirmWrap').hidden = !creating;
    $('localAuthConfirm').required = creating;
    $('localAuthPassword').autocomplete = creating ? 'new-password' : 'current-password';
    $('localAuthSubmit').textContent = creating ? 'Crear perfil y entrar' : 'Entrar en NEXUS HUB';
    $('localAuthSwitch').hidden = getProfiles().length === 0;
    $('localAuthSwitch').textContent = creating
      ? 'Ya tienes un perfil? Iniciar sesión'
      : 'Crear otro perfil local';
    $('localAuthUsername').value = '';
    $('localAuthPassword').value = '';
    $('localAuthConfirm').value = '';
    $('localAuthRemember').checked = false;
    setMessage('');
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB no está disponible en este navegador.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('keys')) {
          request.result.createObjectStore('keys');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacén local.'));
    });
  }

  async function keyDb(action, id, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('keys', 'readwrite');
      const store = transaction.objectStore('keys');
      let request;
      if (action === 'put') request = store.put(key, id);
      else if (action === 'get') request = store.get(id);
      else request = store.delete(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error al leer la clave local.'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Error guardando la clave local.'));
      };
    });
  }

  async function clearRemembered(id) {
    const remembered = localStorage.getItem(REMEMBERED_ID);
    const target = id || remembered;
    if (target) {
      try { await keyDb('delete', target); } catch { /* The local profile remains usable. */ }
    }
    if (!id || remembered === id) localStorage.removeItem(REMEMBERED_ID);
  }

  async function rememberThisDevice(id, key) {
    await clearRemembered();
    // CryptoKey is non-extractable. IndexedDB stores the key object, never the password.
    await keyDb('put', id, key);
    localStorage.setItem(REMEMBERED_ID, id);
  }

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptText(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(text)
    );
    return {
      iv: bytesToB64(iv),
      ciphertext: bytesToB64(new Uint8Array(encrypted))
    };
  }

  async function decryptText(profile, key) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(profile.iv) },
      key,
      b64ToBytes(profile.ciphertext)
    );
    return decoder.decode(plain);
  }

  function persistSnapshot(snapshot) {
    if (!current) return Promise.resolve();
    const profileId = current.profile.id;
    const captured = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);

    writeQueue = writeQueue.catch(() => {}).then(async () => {
      if (!current || current.profile.id !== profileId) return;
      const encrypted = await encryptText(captured, current.key);
      const profiles = getProfiles();
      const index = profiles.findIndex(profile => profile.id === profileId);
      if (index < 0) return;
      profiles[index] = {
        ...profiles[index],
        ...encrypted,
        updatedAt: new Date().toISOString()
      };
      saveProfiles(profiles);
    });
    return writeQueue;
  }

  function persistFromSession() {
    if (!current) return Promise.resolve();
    const snapshot = sessionStorage.getItem(ACTIVE_KEY);
    if (!snapshot) return Promise.resolve();
    return persistSnapshot(snapshot);
  }

  function unlock(profile, data, key, showSetup) {
    current = { profile, key };
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(data || {}));
    $('localAuthGate').hidden = true;
    document.body.classList.remove('local-locked');

    try {
      window.NEXUS_START_APP();
    } catch (error) {
      console.error('NEXUS HUB startup', error);
      document.body.classList.add('local-locked');
      $('localAuthGate').hidden = false;
      setMessage('No se pudo abrir el perfil. Tus datos cifrados siguen guardados. ' + error.message, 'error');
      sessionStorage.removeItem(ACTIVE_KEY);
      current = null;
      return;
    }

    persistFromSession().catch(error => console.error('No se pudo guardar el estado inicial cifrado', error));
    if (showSetup || !profile.setupDone) {
      window.setTimeout(() => { $('localSetupOverlay').hidden = false; }, 180);
    }
  }

  function setupFirstVisit() {
    const finish = () => {
      $('localSetupOverlay').hidden = true;
      if (!current) return;
      const profiles = getProfiles();
      const index = profiles.findIndex(profile => profile.id === current.profile.id);
      if (index >= 0) {
        profiles[index].setupDone = true;
        saveProfiles(profiles);
        current.profile = profiles[index];
      }
    };
    $('localSetupLater').addEventListener('click', finish);
    $('localSetupGo').addEventListener('click', () => {
      finish();
      document.querySelector('#sidebar [data-page="configuracion"]')?.click();
    });
  }

  async function createOrLogin(event) {
    event.preventDefault();
    const username = $('localAuthUsername').value.trim();
    const usernameKey = normalize(username);
    const password = $('localAuthPassword').value;
    const remember = $('localAuthRemember').checked;

    if (!/^[A-Za-z0-9._-]{3,24}$/.test(username)) {
      setMessage('El usuario debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.', 'error');
      return;
    }
    if (password.length < 8) {
      setMessage('La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }

    const submit = $('localAuthSubmit');
    submit.disabled = true;
    submit.textContent = 'PROCESANDO…';

    try {
      if (!window.crypto?.subtle) {
        throw new Error('Este navegador no permite cifrado seguro. Abre NEXUS HUB mediante HTTPS y usa un navegador actualizado.');
      }

      let profile;
      let data;
      let key;

      if (mode === 'create') {
        if (password !== $('localAuthConfirm').value) {
          throw new Error('Las contraseñas no coinciden.');
        }

        const profiles = getProfiles();
        if (profiles.some(item => item.usernameKey === usernameKey)) {
          throw new Error('Ese usuario ya existe en este dispositivo. Elige otro nombre.');
        }

        let initialData = {};
        if (profiles.length === 0) {
          const legacy = localStorage.getItem(LEGACY_KEY);
          if (legacy !== null) {
            try {
              initialData = JSON.parse(legacy) || {};
            } catch {
              throw new Error('Los datos anteriores no se han podido leer. No se han borrado.');
            }
          }
        }

        const salt = crypto.getRandomValues(new Uint8Array(16));
        key = await deriveKey(password, salt);
        const encrypted = await encryptText(JSON.stringify(initialData), key);
        profile = {
          id: crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
          username,
          usernameKey,
          salt: bytesToB64(salt),
          ...encrypted,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          setupDone: false
        };

        profiles.push(profile);
        saveProfiles(profiles);

        // The old unencrypted store is removed only after the encrypted copy exists.
        if (profiles.length === 1 && localStorage.getItem(LEGACY_KEY) !== null) {
          localStorage.removeItem(LEGACY_KEY);
        }
        data = initialData;
        setMessage('Perfil creado. Preparando tu espacio…', 'success');
      } else {
        profile = getProfiles().find(item => item.usernameKey === usernameKey);
        if (!profile) throw new Error('No existe un perfil con ese usuario en este dispositivo.');
        key = await deriveKey(password, b64ToBytes(profile.salt));
        try {
          data = JSON.parse(await decryptText(profile, key));
        } catch {
          throw new Error('Contraseña incorrecta. Comprueba el usuario y vuelve a intentarlo.');
        }
      }

      if (remember) {
        try {
          await rememberThisDevice(profile.id, key);
        } catch (error) {
          await clearRemembered();
          setMessage('Has entrado, pero este navegador no permite recordar el dispositivo. La próxima vez tendrás que escribir la contraseña.', 'error');
        }
      } else {
        await clearRemembered();
      }

      unlock(profile, data, key, mode === 'create');
    } catch (error) {
      setMessage(error.message || 'No se ha podido abrir el perfil.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = mode === 'create' ? 'Crear perfil y entrar' : 'Entrar en NEXUS HUB';
      $('localAuthPassword').value = '';
      $('localAuthConfirm').value = '';
    }
  }

  async function restoreRememberedProfile() {
    const rememberedId = localStorage.getItem(REMEMBERED_ID);
    if (!rememberedId) return false;

    const profile = getProfiles().find(item => item.id === rememberedId);
    if (!profile) {
      await clearRemembered(rememberedId);
      return false;
    }

    try {
      const key = await keyDb('get', rememberedId);
      if (!key) {
        await clearRemembered(rememberedId);
        return false;
      }
      const data = JSON.parse(await decryptText(profile, key));
      unlock(profile, data, key, !profile.setupDone);
      return true;
    } catch (error) {
      console.warn('No se pudo restaurar el perfil recordado', error);
      await clearRemembered(rememberedId);
      setMessage('No se pudo recuperar el acceso recordado. Introduce tu contraseña.', 'error');
      return false;
    }
  }

  async function logout() {
    try {
      await persistFromSession();
      await writeQueue;
    } catch (error) {
      console.error('No se pudo guardar el perfil antes de salir', error);
    }
    await clearRemembered(current?.profile.id);
    sessionStorage.removeItem(ACTIVE_KEY);
    current = null;
    location.reload();
  }

  async function deleteCurrent() {
    if (!current) return;
    const username = current.profile.username;
    if (!confirm('¿Eliminar el perfil local «' + username + '» y todos sus datos de este dispositivo? Esta acción no se puede deshacer.')) return;

    try {
      await persistFromSession();
      await writeQueue;
    } catch (error) {
      console.error('No se pudo completar el último guardado antes de eliminar', error);
    }

    const id = current.profile.id;
    saveProfiles(getProfiles().filter(profile => profile.id !== id));
    await clearRemembered(id);
    sessionStorage.removeItem(ACTIVE_KEY);
    current = null;
    location.reload();
  }

  window.NEXUS_PROFILE_STORE = {
    get username() { return current?.profile.username || 'Perfil local'; },
    persist: data => persistSnapshot(data),
    logout,
    deleteCurrent
  };

  $('localAuthForm').addEventListener('submit', createOrLogin);
  $('localAuthSwitch').addEventListener('click', () => setMode(mode === 'create' ? 'login' : 'create'));
  setupFirstVisit();

  (async () => {
    const profiles = getProfiles();
    setMode(profiles.length ? 'login' : 'create');

    // Offer a safe one-time migration of data from the previous local-only version.
    if (profiles.length === 0 && localStorage.getItem(LEGACY_KEY) !== null) {
      setMessage('Los datos que ya tenías guardados en este navegador se incorporarán al primer perfil que crees.');
    }

    const restored = await restoreRememberedProfile();
    if (!restored) setMode(getProfiles().length ? 'login' : 'create');
  })();

  window.addEventListener('maelhub:datachange', () => {
    persistFromSession().catch(error => {
      console.error('NEXUS local vault', error);
      setMessage('No se pudo guardar el cifrado local. Mantén esta pestaña abierta y vuelve a intentarlo.', 'error');
    });
  });

  window.addEventListener('pagehide', () => {
    persistFromSession().catch(() => {});
  });
})();
