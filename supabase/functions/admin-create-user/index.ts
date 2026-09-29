import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function normalizeUsername(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Yalnızca POST desteklenir." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Supabase sunucu ayarları eksik." }, 500);
  }

  if (!authHeader) {
    return json({ error: "Oturum doğrulanamadı." }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();

  if (userError || !userData.user) {
    return json({ error: "Oturum doğrulanamadı." }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || callerProfile?.role !== "admin") {
    return json({ error: "Bu işlem yalnızca yönetici hesabına açıktır." }, 403);
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "company");
  const companyName = String(body.company_name ?? "").trim();

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return json({
      error: "Kullanıcı adı 3-40 karakter olmalı; yalnızca harf, rakam, nokta, tire ve alt çizgi kullanılabilir."
    }, 400);
  }

  if (password.length < 8) {
    return json({ error: "Parola en az 8 karakter olmalıdır." }, 400);
  }

  if (!fullName) {
    return json({ error: "Ad soyad / yetkili adı zorunludur." }, 400);
  }

  if (!["admin", "company"].includes(role)) {
    return json({ error: "Geçersiz hesap türü." }, 400);
  }

  if (role === "company" && !companyName) {
    return json({ error: "Firma hesabı için firma adı zorunludur." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: duplicateProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();

  if (duplicateProfile) {
    return json({ error: "Bu kullanıcı adı zaten kullanılıyor." }, 409);
  }

  let companyId: string | null = null;

  if (role === "company") {
    const { data: existingCompany, error: companyLookupError } = await admin
      .from("companies")
      .select("id,name")
      .eq("name", companyName)
      .maybeSingle();

    if (companyLookupError) {
      return json({ error: companyLookupError.message }, 400);
    }

    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: createdCompany, error: companyCreateError } = await admin
        .from("companies")
        .insert({ name: companyName })
        .select("id")
        .single();

      if (companyCreateError) {
        return json({ error: companyCreateError.message }, 400);
      }

      companyId = createdCompany.id;
    }
  }

  const email = `${username}@jeo.local`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      full_name: fullName
    }
  });

  if (createError || !created.user) {
    return json({
      error: createError?.message || "Kullanıcı hesabı oluşturulamadı."
    }, 400);
  }

  const { error: profileUpsertError } = await admin
    .from("profiles")
    .upsert({
      id: created.user.id,
      username,
      full_name: fullName,
      role,
      company_id: companyId
    }, { onConflict: "id" });

  if (profileUpsertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileUpsertError.message }, 400);
  }

  return json({
    ok: true,
    id: created.user.id,
    username,
    full_name: fullName,
    role,
    company_id: companyId
  });
});
