(() => {
  const config = window.APP_CONFIG;

  if (!config) {
    throw new Error("APP_CONFIG tidak ditemukan.");
  }

  const url = config.SUPABASE_URL;
  const key = config.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error("APP_CONFIG:", config);
    throw new Error("Supabase config belum diisi.");
  }

  if (!window.supabase) {
    throw new Error("Supabase SDK tidak termuat.");
  }

  if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(url, key);
  }

  console.log("✅ Supabase connected");
})();
