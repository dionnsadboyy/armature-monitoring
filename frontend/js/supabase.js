(() => {
  const config = window.ARMATURE_CONFIG;

  if (!config) {
    throw new Error("ARMATURE_CONFIG tidak ditemukan.");
  }

  const url = config.SUPABASE_URL;
  const key = config.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || url.startsWith("YOUR_") || key.startsWith("YOUR_")) {
    throw new Error("Supabase config DEV belum diisi.");
  }

  if (!window.supabase) {
    throw new Error("Supabase SDK tidak termuat.");
  }

  if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(url, key);
  }

  console.log("Supabase client initialized");
})();
