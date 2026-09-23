// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// QueuePollWorker.kt — WorkManager's minimum periodic interval is 15
// minutes, far too slow to be the primary gateway loop, but it's a
// resilient safety net: if Android kills GatewayService (aggressive
// OEM battery managers, low memory, etc.) this still wakes up every
// ~15 min, restarts the foreground service, and — belt and braces —
// clears one small batch itself so a paired-but-neglected phone
// doesn't leave a school's SMS queue stuck for hours.
// ============================================================

package com.bcbe.smsgateway

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class QueuePollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        private const val UNIQUE_NAME = "cbe_sms_queue_poll"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<QueuePollWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
        }
    }

    override suspend fun doWork(): Result {
        val context = applicationContext
        if (!Prefs.wasGatewayRunning(context)) return Result.success()

        // Nudge the real service back up first...
        GatewayServiceController.start(context)

        // ...and also clear one small batch right here, in case the
        // service takes a moment to actually get scheduled by the OS.
        val token = Prefs.deviceToken(context) ?: return Result.success()
        return try {
            val queueResult = ApiClient.getQueue(context, token, 5)
            if (!queueResult.ok) return Result.retry()
            val messages = queueResult.body.optJSONArray("messages") ?: return Result.success()
            val reports = ArrayList<JSONObject>()
            for (i in 0 until messages.length()) {
                val m = messages.getJSONObject(i)
                val outcome = SmsSender.send(context, m.getString("phone"), m.getString("message"))
                reports.add(JSONObject().apply {
                    put("queueId", m.getString("id"))
                    put("status", if (outcome.success) "sent" else "failed")
                    if (!outcome.success) put("errorMessage", outcome.errorMessage ?: "Unknown error")
                })
            }
            if (reports.isNotEmpty()) ApiClient.updateResults(context, token, reports)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
