// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// SmsSender.kt — sends one message on the phone's own SIM via the
// normal Android SmsManager, and resolves once the radio confirms
// (or rejects) the send — not just "handed to the OS". Long
// messages are split with divideMessage/sendMultipartTextMessage so
// a >160-char message still arrives as one logical text instead of
// silently truncating (8. SMS Segmentation says never truncate).
// ============================================================

package com.bcbe.smsgateway

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

object SmsSender {

    data class SendOutcome(val success: Boolean, val errorMessage: String?)

    suspend fun send(context: Context, phone: String, message: String): SendOutcome = suspendCancellableCoroutine { cont ->
        val smsManager = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java)
        else @Suppress("DEPRECATION") SmsManager.getDefault()

        val parts = smsManager.divideMessage(message)
        val actionBase = "com.bcbe.smsgateway.SMS_SENT_${System.nanoTime()}"
        var remaining = parts.size
        var anyFailure = false
        var lastError: String? = null

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (resultCode != android.app.Activity.RESULT_OK) {
                    anyFailure = true
                    lastError = smsResultToMessage(resultCode)
                }
                remaining--
                if (remaining <= 0) {
                    try { context.unregisterReceiver(this) } catch (e: Exception) { /* already gone */ }
                    if (cont.isActive) cont.resume(SendOutcome(!anyFailure, lastError))
                }
            }
        }
        val filter = IntentFilter(actionBase)
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        try {
            if (parts.size > 1) {
                val sentIntents = ArrayList<PendingIntent>()
                for (i in parts.indices) {
                    val intent = Intent(actionBase).setPackage(context.packageName)
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
                    sentIntents.add(PendingIntent.getBroadcast(context, i, intent, flags))
                }
                smsManager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
            } else {
                val intent = Intent(actionBase).setPackage(context.packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
                val sentIntent = PendingIntent.getBroadcast(context, 0, intent, flags)
                smsManager.sendTextMessage(phone, null, message, sentIntent, null)
            }
        } catch (e: Exception) {
            try { context.unregisterReceiver(receiver) } catch (ignored: Exception) {}
            if (cont.isActive) cont.resume(SendOutcome(false, e.message ?: "SmsManager error"))
        }
    }

    private fun smsResultToMessage(resultCode: Int): String = when (resultCode) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "Generic failure"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No signal / SIM has no service"
        SmsManager.RESULT_ERROR_NULL_PDU -> "Null PDU"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Airplane mode / radio off"
        else -> "SMS send failed (code $resultCode)"
    }
}
