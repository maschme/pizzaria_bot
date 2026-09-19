'use strict';

/**
 * Autenticação do dashboard (token único ADMIN_TOKEN do .env).
 * - Intercepta todo fetch same-origin e injeta o header x-admin-token
 * - Ao receber 401, exibe overlay de login; o token fica em localStorage
 * Incluir como PRIMEIRO script das páginas: <script src="auth.js"></script>
 */
(function () {
  const STORAGE_KEY = 'pizzaria_admin_token';

  function getToken() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
  }
  function setToken(t) {
    try { localStorage.setItem(STORAGE_KEY, t); } catch (_) {}
  }

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
      if (sameOrigin) {
        init = init || {};
        const headers = new Headers(init.headers || (typeof input === 'object' && input.headers) || {});
        const token = getToken();
        if (token && !headers.has('x-admin-token')) headers.set('x-admin-token', token);
        init.headers = headers;
      }
    } catch (_) { /* nunca quebrar o fetch por causa do auth */ }

    return fetchOriginal(input, init).then((res) => {
      if (res.status === 401) mostrarLogin();
      return res;
    });
  };

  function mostrarLogin() {
    if (document.getElementById('authOverlay')) return;
    const criar = () => {
      if (document.getElementById('authOverlay')) return;
      const div = document.createElement('div');
      div.id = 'authOverlay';
      div.innerHTML = `
        <style>
          #authOverlay { position: fixed; inset: 0; z-index: 99999; background: rgba(10,10,14,.92);
            display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
          #authOverlay .auth-box { background: #16161e; border: 1px solid #2a2a35; border-radius: 12px;
            padding: 28px; width: 320px; max-width: 90vw; color: #e6e6ea; text-align: center; }
          #authOverlay h5 { margin: 0 0 6px; font-size: 1.05rem; }
          #authOverlay p { margin: 0 0 16px; font-size: .8rem; color: #9a9aa5; }
          #authOverlay input { width: 100%; box-sizing: border-box; background: #0f0f15; color: #e6e6ea;
            border: 1px solid #2a2a35; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: .9rem; }
          #authOverlay button { width: 100%; background: #dc3545; color: #fff; border: 0; border-radius: 8px;
            padding: 10px; font-weight: 600; cursor: pointer; }
          #authOverlay .auth-erro { color: #ff7b8a; font-size: .75rem; margin-top: 10px; display: none; }
        </style>
        <div class="auth-box">
          <h5>🔐 Acesso restrito</h5>
          <p>Informe o token de administrador (ADMIN_TOKEN)</p>
          <input type="password" id="authTokenInput" placeholder="Token" autocomplete="current-password">
          <button id="authEntrarBtn">Entrar</button>
          <div class="auth-erro" id="authErro">Token inválido, tente novamente.</div>
        </div>`;
      document.body.appendChild(div);

      const input = div.querySelector('#authTokenInput');
      const btn = div.querySelector('#authEntrarBtn');
      const erro = div.querySelector('#authErro');
      input.focus();

      const entrar = async () => {
        const token = input.value.trim();
        if (!token) return;
        // Valida contra um endpoint protegido antes de recarregar
        const res = await fetchOriginal('/whatsapp/status', { headers: { 'x-admin-token': token } });
        if (res.status === 401) {
          erro.style.display = 'block';
          input.select();
          return;
        }
        setToken(token);
        window.location.reload();
      };
      btn.addEventListener('click', entrar);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
    };

    if (document.body) criar();
    else document.addEventListener('DOMContentLoaded', criar);
  }
})();
