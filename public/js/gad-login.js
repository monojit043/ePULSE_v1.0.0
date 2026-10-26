/* ══════════════════════════════════════════════
   GAD — gad-login.js
   Sign-in page for the GAD module only. Credentials are checked by
   /api/login against eil_employees on PC-2; on success always lands
   on gad.html (ignores the role-based redirect /api/login suggests).
   ══════════════════════════════════════════════ */

const GAD_HOME = '/gad.html';

// Already signed in (shared session with gateway) → go straight to GAD
fetch('/api/me')
    .then(r => { if (r.ok) window.location.replace(GAD_HOME); })
    .catch(() => {});

/* ── Slideshow ── */
const slides = document.querySelectorAll('.bg-slide');
let cur = 0;
setInterval(() => {
    slides[cur].classList.remove('active');
    cur = (cur + 1) % slides.length;
    slides[cur].classList.add('active');
}, 8000);

/* ── Eye toggle ── */
const pwInput = document.getElementById('password');
const eyeSvg = document.getElementById('eyeSvg');
const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />`;
const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />`;

document.getElementById('eyeToggle').addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    eyeSvg.innerHTML = show ? EYE_CLOSED : EYE_OPEN;
});

/* ── Sign in ── */
const form = document.getElementById('loginForm');
const idInput = document.getElementById('employeeId');
const errEl = document.getElementById('loginError');
const errText = document.getElementById('errorText');
const submitBtn = document.getElementById('submitBtn');
const btnLabel = document.getElementById('btnLabel');

function showError(msg) {
    errText.textContent = msg;
    errEl.classList.add('show');
    submitBtn.disabled = false;
    btnLabel.textContent = 'Enter GAD';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.remove('show');

    const employeeId = idInput.value.trim();
    const password = pwInput.value;
    if (!employeeId) { idInput.focus(); return showError('Employee ID is required.'); }
    if (!password) { pwInput.focus(); return showError('Password is required.'); }

    submitBtn.disabled = true;
    btnLabel.textContent = 'Signing in…';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeId, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) return showError(data.message || 'Invalid credentials. Please try again.');
        window.location.replace(GAD_HOME);
    } catch {
        showError('Unable to reach server. Check your connection.');
    }
});

[idInput, pwInput].forEach(el => el.addEventListener('input', () => errEl.classList.remove('show')));
idInput.focus();
