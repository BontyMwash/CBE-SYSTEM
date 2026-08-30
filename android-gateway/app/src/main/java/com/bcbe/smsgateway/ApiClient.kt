// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// ApiClient.kt — talks ONLY to the sms-* Edge Functions (never to
// Supabase's REST/database API directly, and never with the service
// role key — this app doesn't have it and never will). Deliberately
// plain HttpURLConnection + org.json so the project needs no extra
// networking dependency to build.
// ============================================================

package com.bcbe.smsgateway

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class ApiResult(val ok: Boolean, val body: JSONObject, val httpStatus: Int)

object ApiClient {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 20_000

    private fun call(context: Context, functionName: String, payload: JSONObject, deviceToken: String? = null): ApiResult {
        val base = Prefs.supabaseUrl(context)
        if (base.isEmpty()) return ApiResult(false, JSONObject().put("error", "Supabase URL not set — open Settings first."), 0)
        val url = URL("$base/functions/v1/$functionName")
        val conn = url.openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.setRequestProperty("Content-Type", "application/json")
            if (deviceToken != null) conn.setRequestProperty("X-Device-Token", deviceToken)

            OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }

            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject().put("error", text) }
            ApiResult(status in 200..299, json, status)
        } catch (e: Exception) {
            ApiResult(false, JSONObject().put("error", e.message ?: "Network error"), 0)
        } finally {
            conn.disconnect()
        }
    }

    // ---- Step 2 of pairing: claim a pair code shown by the admin ----
    fun registerDevice(context: Context, pairCode: String, phoneNumber: String?, deviceLabel: String?): ApiResult {
        val body = JSONObject().put("pairCode", pairCode)
        if (!phoneNumber.isNullOrBlank()) body.put("phoneNumber", phoneNumber)
        if (!deviceLabel.isNullOrBlank()) body.put("deviceLabel", deviceLabel)
        return call(context, "sms-register-device", body)
    }

    fun heartbeat(context: Context, token: String, phoneNumber: String?): ApiResult {
        val body = JSONObject()
        if (!phoneNumber.isNullOrBlank()) body.put("phoneNumber", phoneNumber)
        return call(context, "sms-heartbeat", body, token)
    }

    fun getQueue(context: Context, token: String, batchSize: Int): ApiResult {
        val body = JSONObject().put("batchSize", batchSize)
        return call(context, "sms-get-queue", body, token)
    }

    fun updateResults(context: Context, token: String, results: List<JSONObject>): ApiResult {
        val arr = JSONArray()
        results.forEach { arr.put(it) }
        val body = JSONObject().put("results", arr)
        return call(context, "sms-update-result", body, token)
    }
}
