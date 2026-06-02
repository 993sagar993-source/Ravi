/*
  Authentication logic for Aluminium Blank Business App
*/

// --- Start of functions needed for auth UI ---
const AUTH_KEY = 'aluminium-blank-app:auth_v1';
const SESSION_KEY = 'aluminium-blank-app:session_v1';

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function $(sel){ return document.querySelector(sel); }
function el(tag, props={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k === 'class') n.className = v;
    else if(k === 'text') n.textContent = v;
    else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for(const c of children){
    if(c == null) continue;
    if(typeof c === 'string') n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}

function ensureUxLayer(){
  if (document.getElementById('uxLayer')) return;
  const layer = document.createElement('div');
  layer.id = 'uxLayer';
  layer.innerHTML = `<div id="toastHost" aria-live="polite" aria-atomic="true"></div>`;
  document.body.appendChild(layer);
}

function toast(message, kind='success', durationMs=3200){
  ensureUxLayer();
  const host = $('#toastHost');
  if(!host) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.innerHTML = `<div class="toastMsg">${message}</div>`;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add('toastOut');
    setTimeout(() => t.remove(), 250);
  }, durationMs);
}
// --- End of copied functions ---

function initializeAuth() {
    const authContainer = $('#auth-container');
    const storedHash = localStorage.getItem(AUTH_KEY);

    const showApp = () => {
        sessionStorage.setItem(SESSION_KEY, 'true');
        window.location.href = 'index.html';
    };

    if (!storedHash) {
        // First time setup
        const setupForm = el('div', { class: 'card', id: 'login-card' }, [
            el('h3', { text: 'Create a Password' }),
            el('p', { class: 'muted', text: 'To protect your data on this device, please create a password.' }),
            el('input', { id: 'new-password', type: 'password', class: 'input', placeholder: 'Enter new password', style: 'margin-top: 1rem;' }),
            el('button', { id: 'set-password-btn', class: 'secondary primary', text: 'Set Password', style: 'width: 100%; margin-top: 1rem;' })
        ]);
        authContainer.appendChild(setupForm);

        $('#set-password-btn').onclick = async () => {
            const newPassword = $('#new-password').value;
            if (newPassword.length < 4) {
                toast('Password must be at least 4 characters.', 'danger');
                return;
            }
            const newHash = await hashPassword(newPassword);
            localStorage.setItem(AUTH_KEY, newHash);
            toast('Password set successfully. Please log in.', 'success');
            authContainer.innerHTML = ''; // Clear setup form
            initializeAuth(); // Re-run to show login form
        };
    } else {
        // Login prompt
        const loginForm = el('div', { class: 'card', id: 'login-card' }, [
            el('h3', { text: 'Enter Password' }),
            el('input', { id: 'login-password', type: 'password', class: 'input', placeholder: 'Password', style: 'margin-top: 1rem;' }),
            el('button', { id: 'login-btn', class: 'secondary primary', text: 'Login', style: 'width: 100%; margin-top: 1rem;' })
        ]);
        authContainer.appendChild(loginForm);

        const loginInput = $('#login-password');
        const loginButton = $('#login-btn');

        const handleLogin = async () => {
            const enteredPassword = loginInput.value;
            if (!enteredPassword) return;
            const enteredHash = await hashPassword(enteredPassword);
            if (enteredHash === storedHash) {
                showApp();
            } else {
                toast('Incorrect password.', 'danger');
                loginInput.value = '';
                loginInput.focus();
            }
        };
        loginButton.onclick = handleLogin;
        loginInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        loginInput.focus();
    }
}

initializeAuth();