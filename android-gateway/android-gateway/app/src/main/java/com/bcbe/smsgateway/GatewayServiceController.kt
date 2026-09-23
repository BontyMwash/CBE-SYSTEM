// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
// ============================================================

package com.bcbe.smsgateway

import android.content.Context
import android.content.Intent
import android.os.Build

object GatewayServiceController {
    fun start(context: Context) {
        val intent = Intent(context, GatewayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        QueuePollWorker.schedule(context)
    }

    fun stop(context: Context) {
        context.stopService(Intent(context, GatewayService::class.java))
        Prefs.setGatewayRunning(context, false)
        QueuePollWorker.cancel(context)
    }
}
