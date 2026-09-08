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

  function setLoginLoading(isLoading) {
    if (!submitButton) return;

    submitButton.disabled = isLoading;
    submitButton.setAttribute("aria-busy", String(isLoading));
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;

    if (isLoading) {
      message.classList.add("loading");
      message.textContent = "Memverifikasi akun...";
      submitButton.innerHTML = '<span class="login-spinner" aria-hidden="true"></span><span style="font-size:inherit;margin-left:0">Memproses...</span>';
    } else {
      message.classList.remove("loading");
      submitButton.innerHTML = defaultButtonMarkup;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    setLoginLoading(true);

    try {
      await login(email, password);
    } catch (error) {
      console.error("Login error:", error);
      setLoginLoading(false);
      message.textContent = error.message === "Invalid login credentials"
        ? "Email atau password salah."
        : error.message;
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

window.authGuardReady = requiredRole
  ? requireRole(requiredRole)
  : Promise.resolve(null);
