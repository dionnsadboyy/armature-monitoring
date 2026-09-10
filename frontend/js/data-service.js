(() => {
  if (!window.supabaseClient) {
    throw new Error("Supabase client belum tersedia.");
  }

  // Keep page code independent from Supabase call details.
  // Supabase remains the only source of truth in every environment.
  const loadMaterials = () => {
    let query = window.supabaseClient
      .from("armature_dashboard")
      .select("*")
      .eq("armature_type", "K62")
      .eq("is_active", true);

    return query.order("part_number");
  };

  const loadRequestHistory = () => window.supabaseClient
    .from("armature_request_history")
    .select("*")
    .eq("status", "DONE")
    .order("handled_at", { ascending: false })
    .order("id", { ascending: false });

  const callRpc = (name, args) => window.supabaseClient.rpc(name, args);

  window.appDataService = {
    loadMaterials,
    loadRequestHistory,
    callRpc,
  };
})();
