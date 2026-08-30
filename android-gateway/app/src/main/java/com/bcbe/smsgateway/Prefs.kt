// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// Prefs.kt — the device's own bearer token (from sms-register-device)
// lives ONLY here, encrypted at rest. It is never logged and never
// sent anywhere except as the X-Device-Token header on calls to the
// sms-* Edge Functions. There is no service-role key anywhere in
// this app (12. Device Security / 28. Security Requirements).
// ============================================================

package com.bcbe.smsgateway

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object Prefs {
    private const val FILE_NAME = "cbe_sms_gateway_secure_prefs"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_NAME = "device_name"
    private const val KEY_SUPABASE_URL = "supabase_url"
    private const val KEY_GATEWAY_RUNNING = "gateway_running"

    private fun prefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context, FILE_NAME, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun isPaired(context: Context): Boolean = deviceToken(context) != null

    fun deviceToken(context: Context): String? = prefs(context).getString(KEY_DEVICE_TOKEN, null)
    fun deviceId(context: Context): String? = prefs(context).getString(KEY_DEVICE_ID, null)
    fun deviceName(context: Context): String = prefs(context).getString(KEY_DEVICE_NAME, "CBE SMS Gateway") ?: "CBE SMS Gateway"

    // Change this to your own project's URL before building — see
    // SMS_GATEWAY_SETUP.md. Falls back to the value baked in at
    // BuildConfig/first-run if the admin has already set one.
    fun supabaseUrl(context: Context): String = prefs(context).getString(KEY_SUPABASE_URL, "") ?: ""
    fun setSupabaseUrl(context: Context, url: String) = prefs(context).edit().putString(KEY_SUPABASE_URL, url.trim().trimEnd('/')).apply()

    fun savePairing(context: Context, deviceId: String, deviceToken: String, deviceName: String) {
        prefs(context).edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, deviceToken)
            .putString(KEY_DEVICE_NAME, deviceName)
            .apply()
    }

    fun clearPairing(context: Context) {
        prefs(context).edit()
            .remove(KEY_DEVICE_ID).remove(KEY_DEVICE_TOKEN).remove(KEY_DEVICE_NAME)
            .apply()
    }

    fun setGatewayRunning(context: Context, running: Boolean) = prefs(context).edit().putBoolean(KEY_GATEWAY_RUNNING, running).apply()
    fun wasGatewayRunning(context: Context): Boolean = prefs(context).getBoolean(KEY_GATEWAY_RUNNING, false)
}
