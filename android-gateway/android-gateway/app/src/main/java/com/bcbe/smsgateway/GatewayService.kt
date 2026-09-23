// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// GatewayService.kt — the actual gateway loop. While running it:
//   1. Sends a heartbeat.
//   2. Polls sms-get-queue for a small batch of pending messages.
//   3. Sends each one on the SIM (with a configurable delay between
//      sends, mirroring SMS Settings' "delay between messages" so a
//      burst doesn't look like spam to the carrier).
//   4. Reports every result back via sms-update-result.
//   5. Sleeps, then repeats.
//
// Runs as a foreground service (with a persistent notification, as
// Android requires) so the OS is much less likely to kill it while
// the phone is idle. WorkManager (see QueuePollWorker) is a backup
// poll for when the service does get killed anyway.
// ============================================================

package com.bcbe.smsgateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

class GatewayService : Service() {

    companion object {
        const val CHANNEL_ID = "cbe_sms_gateway_channel"
        const val NOTIFICATION_ID = 1001
        const val POLL_INTERVAL_MS = 8_000L
        const val HEARTBEAT_EVERY_N_POLLS = 3
        const val SEND_DELAY_MS = 1_500L
        const val BATCH_SIZE = 10

        var isRunning = false
            private set
        var lastStatusText = "Stopped"
            private set
    }

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var loopCount = 0

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isRunning) {
            isRunning = true
            Prefs.setGatewayRunning(this, true)
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
            scope.launch { loop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        Prefs.setGatewayRunning(this, false)
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun loop() {
        while (isRunning) {
            val token = Prefs.deviceToken(this)
            if (token == null) {
                setStatus("Not paired")
                delay(POLL_INTERVAL_MS)
                continue
            }

            try {
                if (loopCount % HEARTBEAT_EVERY_N_POLLS == 0) {
                    ApiClient.heartbeat(this, token, null)
                }
                val result = ApiClient.getQueue(this, token, BATCH_SIZE)
                if (result.ok) {
                    val messages = result.body.optJSONArray("messages")
                    val count = messages?.length() ?: 0
                    if (count == 0) {
                        setStatus("Idle — waiting for messages")
                    } else {
                        setStatus("Sending $count message${if (count == 1) "" else "s"}…")
                        val reports = ArrayList<JSONObject>()
                        for (i in 0 until count) {
                            val m = messages!!.getJSONObject(i)
                            val outcome = SmsSender.send(this, m.getString("phone"), m.getString("message"))
                            reports.add(JSONObject().apply {
                                put("queueId", m.getString("id"))
                                put("status", if (outcome.success) "sent" else "failed")
                                if (!outcome.success) put("errorMessage", outcome.errorMessage ?: "Unknown error")
                            })
                            delay(SEND_DELAY_MS)
                        }
                        ApiClient.updateResults(this, token, reports)
                        setStatus("Sent batch of $count")
                    }
                } else {
                    setStatus("Gateway error: ${result.body.optString("error", "unknown")}")
                }
            } catch (e: Exception) {
                setStatus("Network error: ${e.message}")
            }

            loopCount++
            delay(POLL_INTERVAL_MS)
        }
    }

    private fun setStatus(text: String) {
        lastStatusText = text
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CBE SMS Gateway — ${Prefs.deviceName(this)}")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "SMS Gateway status", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Shows whether the CBE SMS Gateway is running and what it's doing."
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
