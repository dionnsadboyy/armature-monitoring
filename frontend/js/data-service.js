(() => {
  if (!window.supabaseClient) {
    throw new Error("Supabase client belum tersedia.");
  }

  // Keep page code independent from Supabase call details.
  // Supabase remains the only source of truth in every environment.
  const loadMaterials = (armatureType = "K62") => {
    let query = window.supabaseClient
      .from("armature_dashboard")
      .select("*")
      .eq("armature_type", armatureType)
      .eq("is_active", true);

    return query.order("part_number");
  };

  const loadRequestHistory = () => window.supabaseClient
    .from("armature_request_history")
    .select("*")
    .eq("status", "DONE")
    .order("handled_at", { ascending: false })
    .order("id", { ascending: false });

  const loadRunningStates = () => window.supabaseClient
    .from("armature_running")
    .select("machine_code,is_machine_down,armature_id,updated_at,updated_by")
    .order("machine_code");

  const callRpc = (name, args) => window.supabaseClient.rpc(name, args);

  window.appDataService = {
    loadMaterials,
    loadRequestHistory,
    loadRunningStates,
    callRpc,
  };
})();
