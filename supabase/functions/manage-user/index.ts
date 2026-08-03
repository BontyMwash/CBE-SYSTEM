// ============================================================
// supabase/functions/manage-user/index.ts
//
// Deploy with:  supabase functions deploy manage-user
//
// Handles the three login-management actions that require the
// SERVICE ROLE KEY (creating a login for someone else, resetting
// someone else's password, deleting a login). That key must never
// reach the browser, so it lives only here, server-side. Every
// request is checked against the CALLER's own session and role
// before anything happens.
//
// Request body shapes:
//   { action: 'create', email, password, name, role, schoolId?, schoolName? }
//   { action: 'resetPassword', userId, newPassword }
//   { action: 'delete', userId }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid session" }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles").select("role, school_id").eq("id", caller.id).single();
    if (profileErr || !callerProfile) return json({ error: "Caller has no profile" }, 403);

    const body = await req.json();

    if (body.action === "create") return await handleCreate(adminClient, callerProfile, body);
    if (body.action === "resetPassword") return await handleResetPassword(adminClient, callerProfile, body);
    if (body.action === "delete") return await handleDelete(adminClient, callerProfile, caller.id, body);

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function handleCreate(adminClient: any, callerProfile: any, body: any) {
  const { email, password, name, role, schoolId, schoolName } = body;
  if (!email || !password || !name || !role) {
    return json({ error: "email, password, name, and role are required" }, 400);
  }
  if (!["admin", "user"].includes(role)) {
    return json({ error: "role must be 'admin' or 'user'" }, 400);
  }

  let targetSchoolId = schoolId;

  if (callerProfile.role === "superadmin") {
    if (!targetSchoolId && schoolName) {
      const { data: newSchool, error: schoolErr } = await adminClient
        .from("schools").insert({ name: schoolName }).select().single();
      if (schoolErr) return json({ error: schoolErr.message }, 400);
      targetSchoolId = newSchool.id;
    }
    if (!targetSchoolId) return json({ error: "schoolId or schoolName is required" }, 400);
  } else if (callerProfile.role === "admin") {
    if (role !== "user") return json({ error: "Admins can only create 'user' logins" }, 403);
    targetSchoolId = callerProfile.school_id;

    const { data: school } = await adminClient
      .from("schools").select("frozen").eq("id", targetSchoolId).single();
    if (school?.frozen) {
      return json({ error: "This school's account is frozen — contact support to reactivate before adding logins." }, 403);
    }
  } else {
    return json({ error: "Not authorized to create logins" }, 403);
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr) return json({ error: createErr.message }, 400);

  const { error: insertErr } = await adminClient.from("profiles").insert({
    id: created.user.id, school_id: targetSchoolId, role, name,
  });
  if (insertErr) {
    await adminClient.auth.admin.deleteUser(created.user.id); // roll back
    return json({ error: insertErr.message }, 400);
  }

  return json({ ok: true, userId: created.user.id, schoolId: targetSchoolId });
}

async function handleResetPassword(adminClient: any, callerProfile: any, body: any) {
  const { userId, newPassword } = body;
  if (!userId || !newPassword) return json({ error: "userId and newPassword are required" }, 400);

  const allowed = await canManage(adminClient, callerProfile, userId);
  if (!allowed) return json({ error: "Not authorized to reset this user's password" }, 403);

  const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleDelete(adminClient: any, callerProfile: any, callerId: string, body: any) {
  const { userId } = body;
  if (!userId) return json({ error: "userId is required" }, 400);
  if (userId === callerId) return json({ error: "You can't delete your own login" }, 400);

  const allowed = await canManage(adminClient, callerProfile, userId);
  if (!allowed) return json({ error: "Not authorized to delete this user" }, 403);

  // Deleting the auth user cascades to delete their profiles row too.
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

// Superadmin can manage anyone. Admin can only manage logins in their own school.
async function canManage(adminClient: any, callerProfile: any, targetUserId: string): Promise<boolean> {
  if (callerProfile.role === "superadmin") return true;
  if (callerProfile.role !== "admin") return false;
  const { data: target } = await adminClient.from("profiles").select("school_id").eq("id", targetUserId).single();
  return !!target && target.school_id === callerProfile.school_id;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
