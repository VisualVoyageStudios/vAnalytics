// Already signed in? Skip the form entirely and honor any pending redirect.
(function(){
    const existingToken = localStorage.getItem('token');
    if(existingToken){
        const params = new URLSearchParams(window.location.search);
        const redirectTo = params.get('redirect');
        const plan = params.get('plan');
        window.location.href = redirectTo === 'pricing'
            ? (plan ? `pricing.html?autoplan=${plan}` : 'pricing.html')
            : 'dashboard/dashboard.html';
    }
})();

// rate limit---
function startCooldown(btn, seconds){
    setLoading(btn, false);
    btn.disabled = true;
    const textEl = btn.querySelector('.btn-text');
    const originalText = textEl.textContent;
    let remaining = seconds;
    textEl.textContent = `Try again in ${remaining}s`;
    const interval = setInterval(() => {
        remaining--;
        if(remaining <= 0){
            clearInterval(interval);
            btn.disabled = false;
            textEl.textContent = originalText;
        } else {
            textEl.textContent = `Try again in ${remaining}s`;
        }
    }, 1000);
}

// --- caps warning---
function setupCapsLockWarning(inputId, warningId){
    const input = document.getElementById(inputId);
    const warning = document.getElementById(warningId);
    if(!input || !warning) return;
    const handler = (e) => {
        warning.classList.toggle('visible', !!(e.getModifierState && e.getModifierState('CapsLock')));
    };
    input.addEventListener('keyup', handler);
    input.addEventListener('keydown', handler);
    input.addEventListener('blur', () => warning.classList.remove('visible'));
}
setupCapsLockWarning('password', 'capsLockWarningLogin');
setupCapsLockWarning('registerPassword', 'capsLockWarningRegister');

// --- google auth---
document.querySelectorAll('#googleSignInBtn, #googleSignUpBtn').forEach(btn => {
    btn?.addEventListener('click', () => {
        const params = new URLSearchParams(window.location.search);
        if(params.get('redirect') === 'pricing'){
            const plan = params.get('plan');
            localStorage.setItem('voyager_post_oauth_redirect', plan ? `pricing.html?autoplan=${plan}` : 'pricing.html');
        }
        window.location.href = `${API_URL}/auth/google/login`;
    });
});

(function() {
    'use strict';

    // ─── DOM Helpers ───
    const $ = (sel, ctx = document) => ctx.querySelector(sel);

    // ─── Toast System ───
    const TOAST_TYPES = {
        success: { icon: 'fa-circle-check', title: 'Success' },
        error:   { icon: 'fa-circle-xmark', title: 'Error' },
        warning: { icon: 'fa-triangle-exclamation', title: 'Warning' },
        info:    { icon: 'fa-circle-info', title: 'Info' },
    };

    window.showToast = function(type, title, message, duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const config = TOAST_TYPES[type] || TOAST_TYPES.info;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon"><i class="fas ${config.icon}"></i></span>
            <div class="toast-content">
                <div class="toast-title">${title || config.title}</div>
                <div class="toast-message">${message || ''}</div>
            </div>
            <button class="toast-close" aria-label="Close notification">
                <i class="fas fa-xmark"></i>
            </button>
        `;
        container.appendChild(toast);

        toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
        if (duration > 0) setTimeout(() => removeToast(toast), duration);
        return toast;
    };

    function removeToast(toast) {
        toast.style.animation = 'toastOut 0.25s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }

    
    // ─── Validation ───
    const Validators = {
        email(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); },
        password(value) { return value.length >= 8; },
        match(value, compare) { return value === compare; },
    };

    function setFieldError(input, errorEl, message) {
        input.classList.add('error');
        input.classList.remove('valid');
        if (errorEl) {
            if (message) errorEl.textContent = message;
            errorEl.classList.add('visible');
        }
    }

    function setFieldValid(input, errorEl) {
        input.classList.remove('error');
        input.classList.add('valid');
        if (errorEl) errorEl.classList.remove('visible');
    }

    function clearFieldState(input, errorEl) {
        input.classList.remove('error', 'valid');
        if (errorEl) errorEl.classList.remove('visible');
    }

    function getVal(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function setLoading(btn, loading) {
        btn.classList.toggle('btn-loading', loading);
        btn.disabled = loading;
    }

    // ─── Password show/hide toggle ───
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function() {
            const input = this.closest('.input-wrapper').querySelector('input');
            const icon  = this.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    // ─── Password Strength Meter ───
    const pwInput = document.getElementById('registerPassword');
    const segs    = ['seg1', 'seg2', 'seg3', 'seg4'];
    const label   = document.getElementById('strengthLabel');

    function calculateStrength(pw) {
        if (pw.length === 0) return 0;
        let score = 1;
        if (pw.length >= 8) score++;
        if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
        if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
        return Math.min(score, 4);
    }

    pwInput?.addEventListener('input', function() {
        const score  = calculateStrength(this.value);
        const labels = ['—', 'Weak', 'Fair', 'Good', 'Strong'];
        const colors = ['', 'weak', 'fair', 'good', 'strong'];

        segs.forEach((id, i) => {
            const el = document.getElementById(id);
            el.className = 'segment';
            if (i < score) el.classList.add('active-' + colors[score]);
        });

        label.textContent = this.value.length === 0 ? '—' : labels[score];
        label.className   = 'strength-label ' + (this.value.length === 0 ? '' : colors[score]);

        // re-check confirm password match live as strength changes
        const confirmInput = document.getElementById('confirmPassword');
        const confirmError = document.getElementById('confirmPasswordError');
        if (confirmInput && confirmInput.value.length > 0) {
            if (Validators.match(confirmInput.value, this.value)) {
                setFieldValid(confirmInput, confirmError);
            } else {
                setFieldError(confirmInput, confirmError, 'Passwords do not match');
            }
        }
    });

    // ─── Tab Switching (Sign In / Sign Up) ───
    const tabs   = document.querySelectorAll('.auth-tabs button');
    const panels = {
        signin: document.getElementById('panel-signin'),
        signup: document.getElementById('panel-signup'),
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const target = this.dataset.tab;
            Object.keys(panels).forEach(key => {
                panels[key].classList.toggle('active', key === target);
            });
        });
    });

    document.getElementById('switchToSignup')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('.auth-tabs button[data-tab="signup"]').click();
    });
    document.getElementById('switchToSignin')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('.auth-tabs button[data-tab="signin"]').click();
    });

    // ─── Forgot Password ───
    // No backend email-reset flow exists yet — point users to manual support
    // instead of faking a flow. Replace the email below with your real support address.
    document.getElementById('forgotPasswordLink')?.addEventListener('click', function(e) {
        e.preventDefault();
        showToast('info', 'Need a password reset?', 'Email visualvoyagerbsn@gmail.com from your account email and we\'ll help you reset it.');
    });

    // ─── Remember Me / Welcome Back (email convenience only — not a security feature) ───
    function checkWelcomeBack() {
        const savedEmail = localStorage.getItem('voyager_remember_email');
        const welcomeEl  = document.getElementById('welcomeBack');
        if (savedEmail) {
            document.getElementById('welcomeEmail').textContent = savedEmail;
            welcomeEl.classList.add('visible');
            document.getElementById('email').value = savedEmail;
        } else {
            welcomeEl.classList.remove('visible');
        }
    }
    checkWelcomeBack();

    document.getElementById('notYou')?.addEventListener('click', function() {
        localStorage.removeItem('voyager_remember_email');
        document.getElementById('welcomeBack').classList.remove('visible');
        document.getElementById('email').value = '';
    });

    // ─── Real-time validation: Login ───
    const emailInput    = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailError    = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');

    emailInput?.addEventListener('input', function() {
        if (this.value.length === 0) return clearFieldState(this, emailError);
        Validators.email(this.value) ? setFieldValid(this, emailError) : setFieldError(this, emailError);
    });

    // ─── Login submit — REAL backend call only ───
    const loginForm = document.getElementById('loginForm');
    loginForm?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email    = getVal('email');
        const password = getVal('password');
        const remember = document.getElementById('rememberMe')?.checked;

        let valid = true;
        if (!Validators.email(email)) { setFieldError(emailInput, emailError, 'Please enter a valid email address'); valid = false; }
        if (!password) { setFieldError(passwordInput, passwordError, 'Password is required'); valid = false; }
        if (!valid) return;

        const btn = document.getElementById('loginBtn');
        setLoading(btn, true);

        try {
            const result = await loginUser({ email, password });

            if (result._status === 429) {
                showToast('warning', 'Too many attempts', 'Please wait a minute before trying again.');
                startCooldown(btn, 60);
                return;
            }

            if (result.token) {
                localStorage.setItem('token', result.token);
                if (remember) {
                    localStorage.setItem('voyager_remember_email', email);
                } else {
                    localStorage.removeItem('voyager_remember_email');
                }
                showToast('success', 'Welcome back!', 'Redirecting to your dashboard…');
                setTimeout(() => window.location.href = 'dashboard/dashboard.html', 700);
            } else {
                showToast('error', 'Sign in failed', result.detail || 'Invalid email or password.');
            }
        } catch (err) {
            console.error(err);
            showToast('error', 'Something went wrong', 'Please check your connection and try again.');
        } finally {
            setLoading(btn, false);
        }
    });

    // ─── Real-time validation: Register ───
    const regEmailInput   = document.getElementById('registerEmail');
    const regPasswordInput= document.getElementById('registerPassword');
    const confirmInput    = document.getElementById('confirmPassword');
    const regEmailError   = document.getElementById('registerEmailError');
    const regPasswordError= document.getElementById('registerPasswordError');
    const confirmError    = document.getElementById('confirmPasswordError');

    regEmailInput?.addEventListener('input', function() {
        if (this.value.length === 0) return clearFieldState(this, regEmailError);
        Validators.email(this.value) ? setFieldValid(this, regEmailError) : setFieldError(this, regEmailError, 'Please enter a valid email address');
    });

    regPasswordInput?.addEventListener('input', function() {
        if (this.value.length === 0) {
            clearFieldState(this, regPasswordError);
        } else {
            Validators.password(this.value) ? setFieldValid(this, regPasswordError) : setFieldError(this, regPasswordError, 'Password must be at least 8 characters');
        }
    });

    confirmInput?.addEventListener('input', function() {
        if (this.value.length === 0) return clearFieldState(this, confirmError);
        Validators.match(this.value, regPasswordInput.value) ? setFieldValid(this, confirmError) : setFieldError(this, confirmError, 'Passwords do not match');
    });

    // ─── Register submit — REAL backend call only ───
    const registerForm = document.getElementById('registerForm');
    registerForm?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email    = getVal('registerEmail');
        const password = getVal('registerPassword');
        const confirm  = getVal('confirmPassword');
        const terms    = document.getElementById('termsCheck');

        let valid = true;
        if (!Validators.email(email)) { setFieldError(regEmailInput, regEmailError, 'Please enter a valid email address'); valid = false; }
        if (!Validators.password(password)) { setFieldError(regPasswordInput, regPasswordError, 'Password must be at least 8 characters'); valid = false; }
        if (!Validators.match(confirm, password)) { setFieldError(confirmInput, confirmError, 'Passwords do not match'); valid = false; }
        if (!terms || !terms.checked) { showToast('warning', 'Terms required', 'Please agree to the Terms of Service and Privacy Policy.'); valid = false; }
        if (!valid) return;

        const btn = document.getElementById('registerBtn');
        setLoading(btn, true);

        try {
            const result = await registerUser({ email, password });

            if (result._status === 429) {
                showToast('warning', 'Too many attempts', 'Please wait a minute before trying again.');
                startCooldown(btn, 60);
                return;
            }

            if (result._status === 400) {
                showToast('error', 'Registration failed', result.detail || 'Email already exists.');
                return;
            }

            showToast('success', 'Account created!', 'Signing you in…');

            const loginResult = await loginUser({ email, password });
            if (loginResult.token) {
                localStorage.setItem('token', loginResult.token);
                setTimeout(() => window.location.href = 'dashboard/dashboard.html', 700);
            } else {
                setTimeout(() => window.location.href = 'auth.html', 900);
            }
        } catch (err) {
            console.error(err);
            showToast('error', 'Something went wrong', 'Please check your connection and try again.');
        } finally {
            setLoading(btn, false);
        }
    });

    console.log('Voyager Auth ready.');
})();
