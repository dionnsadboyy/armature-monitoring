const ROLE_ROUTES = {
  bop: "../GEDUNG1/index.html",
  viewer: "../GEDUNG2/index.html",
};
const LOGIN_ROUTE = "../LOGIN/index.html";

function redirectToLogin() {
  window.location.assign(LOGIN_ROUTE);
}

function redirectToRole(role) {
  const route = ROLE_ROUTES[role];

  if (!route) {
    throw new Error("Role user tidak valid.");
  }

  window.location.assign(route);
}

function getRoleDestination(role) {
  return role === "bop" ? "Gedung 1" : "Gedung 2";
}

async function showLoginSuccess(role) {
  const loginCard = document.getElementById("login-card");
  const sessionState = document.getElementById("session-state");
  if (!loginCard || !sessionState) return;

  loginCard.dataset.sessionState = "redirecting";
  loginCard.setAttribute("aria-busy", "true");
  sessionState.innerHTML = `<span class="success-copy"><strong>Login berhasil</strong><small>Mengarahkan ke ${getRoleDestination(role)}...</small></span>`;

  await new Promise((resolve) => window.setTimeout(resolve, 300));
}

async function getAuthenticatedProfile() {
  const {
    data: { session },
    error: sessionError,
  } = await window.supabaseClient.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session?.user) {
    return null;
  }

  const { data: profile, error: profileError } = await window.supabaseClient
    .from("profiles")
    .select("full_name, role")
    .eq("id", session.user.id)
    .single();

  if (profileError || !profile || !ROLE_ROUTES[profile.role]) {
    await window.supabaseClient.auth.signOut();
    return null;
  }

  return { session, profile };
}

async function login(email, password) {
  const { error } = await window.supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  const authenticated = await getAuthenticatedProfile();

  if (!authenticated) {
    throw new Error("Profile user tidak ditemukan atau role tidak valid.");
  }

  await showLoginSuccess(authenticated.profile.role);
  redirectToRole(authenticated.profile.role);
}

async function logout() {
  await window.supabaseClient.auth.signOut();
  redirectToLogin();
}

async function getCurrentSession() {
  const authenticated = await getAuthenticatedProfile();
  return authenticated?.session ?? null;
}

async function requireRole(requiredRole) {
  try {
    const authenticated = await getAuthenticatedProfile();

    if (!authenticated) {
      redirectToLogin();
      return null;
    }

    if (authenticated.profile.role !== requiredRole) {
      redirectToRole(authenticated.profile.role);
      return null;
    }

    const nameElement = document.getElementById("user-name");
    const roleElement = document.getElementById("user-role");
    if (nameElement) nameElement.textContent = authenticated.profile.full_name || authenticated.profile.role.toUpperCase();
    if (roleElement) roleElement.textContent = authenticated.profile.role === "bop" ? "Gedung 1 · BOP" : "Gedung 2 · Viewer";

    return authenticated;
  } catch (error) {
    console.error("Session guard error:", error);
    redirectToLogin();
    return null;
  }
}

window.authService = {
  login,
  logout,
  getCurrentSession,
  getAuthenticatedProfile,
  requireRole,
};

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const message = document.getElementById("message");
  const submitButton = loginForm.querySelector('button[type="submit"]');
  const defaultButtonMarkup = submitButton?.innerHTML ?? "Login";
  let loginPending = false;

  function setLoginLoading(isLoading) {
    if (!submitButton) return;

    submitButton.disabled = isLoading;
    submitButton.setAttribute("aria-busy", String(isLoading));
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;

    if (isLoading) {
      message.classList.add("loading");
      message.classList.remove("error", "success");
      message.textContent = "";
      submitButton.innerHTML = '<span class="login-spinner" aria-hidden="true"></span><span class="button-label">Memverifikasi...</span>';
    } else {
      message.classList.remove("loading");
      submitButton.innerHTML = defaultButtonMarkup;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginPending) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    loginPending = true;
    setLoginLoading(true);

    try {
      await login(email, password);
    } catch (error) {
      const invalidCredentials = /invalid login credentials/i.test(error?.message || "");
      if (!invalidCredentials) console.error("Login error:", error);
      loginPending = false;
      setLoginLoading(false);
      message.classList.add("error");
      message.textContent = invalidCredentials
        ? "Email atau password salah."
        : "Tidak dapat masuk. Silakan coba kembali.";
    }
  });
}

const passwordToggle = document.getElementById("toggle");
const passwordInput = document.getElementById("password");

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener("click", () => {
    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    passwordToggle.setAttribute(
      "aria-label",
      showPassword ? "Sembunyikan password" : "Tampilkan password"
    );
    passwordToggle.setAttribute("aria-pressed", String(showPassword));
  });
}

const requiredRole = document.body?.dataset.requiredRole;

async function initializeLoginPage() {
  const loginCard = document.getElementById("login-card");
  if (!loginCard) return null;

  try {
    const authenticated = await getAuthenticatedProfile();
    if (authenticated) {
      const sessionMessage = document.getElementById("session-message");
      if (sessionMessage) sessionMessage.textContent = `Mengarahkan ke ${getRoleDestination(authenticated.profile.role)}...`;
      redirectToRole(authenticated.profile.role);
      return authenticated;
    }
  } catch (error) {
    console.error("Initial session check error:", error);
  }

  loginCard.dataset.sessionState = "ready";
  loginCard.setAttribute("aria-busy", "false");
  document.getElementById("email")?.focus();
  return null;
}

window.authGuardReady = requiredRole
  ? requireRole(requiredRole)
  : initializeLoginPage();
