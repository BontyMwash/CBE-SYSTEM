// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
// ============================================================

package com.bcbe.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (Prefs.isPaired(context) && Prefs.wasGatewayRunning(context)) {
            GatewayServiceController.start(context)
        }
    }
}
