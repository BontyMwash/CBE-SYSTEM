/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   supabaseClient.js — one shared Supabase client for the app.

   Fill in your project's URL and anon (public) key below. The
   anon key is SAFE to expose in client-side code — it's meant to
   be public. Access control is enforced by the Row Level Security
   policies in sql/schema.sql, not by hiding this key.
   Find both under: Supabase Dashboard → Project Settings → API.
   ============================================================ */

const SUPABASE_URL = 'https://gxebywxbkeqigabajffi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4ZWJ5d3hia2VxaWdhYmFqZmZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NTk4MzksImV4cCI6MjEwMTIzNTgzOX0.7z9xHf-6CeSL1yRR5XFIrjXD4oT6FpxRrhpQTmYXOoU';

// NOTE: assign to window.supabase (don't re-declare with const/let) —
// the Supabase CDN script already creates a global `supabase` object,
// and re-declaring it causes "Identifier 'supabase' has already been
// declared".
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
