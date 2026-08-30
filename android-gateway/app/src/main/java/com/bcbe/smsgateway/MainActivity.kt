// ============================================================
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// MainActivity.kt — pairing screen + gateway status/controls.
// Requests SEND_SMS and POST_NOTIFICATIONS through Android's normal
// runtime permission flow, and nothing else — see AndroidManifest
// for why each declared permission is actually needed (27. Android
// Project / 28. Security Requirements).
// ============================================================

package com.bcbe.smsgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.bcbe.smsgateway.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val uiHandler = Handler(Looper.getMainLooper())
    private val statusPoller = object : Runnable {
        override fun run() {
            refreshStatusText()
            uiHandler.postDelayed(this, 2000)
        }
    }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        if (results[Manifest.permission.SEND_SMS] != true) {
            Toast.makeText(this, "SMS permission is required for this phone to act as a gateway.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.supabaseUrlInput.setText(Prefs.supabaseUrl(this))
        binding.saveUrlBtn.setOnClickListener {
            val url = binding.supabaseUrlInput.text.toString().trim()
            if (url.isEmpty()) { Toast.makeText(this, "Enter your project's Supabase URL first", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
            Prefs.setSupabaseUrl(this, url)
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        }

        binding.pairBtn.setOnClickListener { onPairClicked() }
        binding.toggleGatewayBtn.setOnClickListener { onToggleGateway() }
        binding.batteryOptBtn.setOnClickListener { requestBatteryOptimizationExemption() }
        binding.unpairBtn.setOnClickListener { onUnpair() }

        requestRuntimePermissions()
        refreshUiForPairingState()
    }

    override fun onResume() {
        super.onResume()
        uiHandler.post(statusPoller)
    }

    override fun onPause() {
        super.onPause()
        uiHandler.removeCallbacks(statusPoller)
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf(Manifest.permission.SEND_SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    private fun onPairClicked() {
        if (Prefs.supabaseUrl(this).isEmpty()) { Toast.makeText(this, "Save your Supabase URL first", Toast.LENGTH_SHORT).show(); return }
        val code = binding.pairCodeInput.text.toString().trim().uppercase()
        if (code.isEmpty()) { Toast.makeText(this, "Enter the pairing code", Toast.LENGTH_SHORT).show(); return }
        val phone = binding.phoneNumberInput.text.toString().trim()

        binding.pairBtn.isEnabled = false
        CoroutineScope(Dispatchers.IO).launch {
            val result = ApiClient.registerDevice(this@MainActivity, code, phone.ifBlank { null }, Build.MODEL)
            runOnUiThread {
                binding.pairBtn.isEnabled = true
                if (result.ok) {
                    Prefs.savePairing(
                        this@MainActivity,
                        result.body.getString("deviceId"),
                        result.body.getString("deviceToken"),
                        result.body.optString("deviceName", "CBE SMS Gateway")
                    )
                    Toast.makeText(this@MainActivity, "Paired! You can start the gateway now.", Toast.LENGTH_LONG).show()
                    refreshUiForPairingState()
                } else {
                    Toast.makeText(this@MainActivity, result.body.optString("error", "Pairing failed"), Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun onToggleGateway() {
        if (GatewayService.isRunning) {
            GatewayServiceController.stop(this)
        } else {
            GatewayServiceController.start(this)
        }
        uiHandler.postDelayed({ refreshStatusText() }, 300)
    }

    private fun onUnpair() {
        GatewayServiceController.stop(this)
        Prefs.clearPairing(this)
        refreshUiForPairingState()
        Toast.makeText(this, "Unpaired. Ask your administrator for a new pairing code to reconnect.", Toast.LENGTH_LONG).show()
    }

    private fun requestBatteryOptimizationExemption() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            startActivity(intent)
        } else {
            Toast.makeText(this, "Already allowed to run in the background.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun refreshUiForPairingState() {
        val paired = Prefs.isPaired(this)
        binding.pairingSection.visibility = if (paired) android.view.View.GONE else android.view.View.VISIBLE
        binding.statusSection.visibility = if (paired) android.view.View.VISIBLE else android.view.View.GONE
        if (paired) {
            binding.pairedDeviceText.text = "Paired as: ${Prefs.deviceName(this)}"
            refreshStatusText()
        }
    }

    private fun refreshStatusText() {
        if (!Prefs.isPaired(this)) return
        binding.toggleGatewayBtn.text = if (GatewayService.isRunning) "Stop Gateway" else "Start Gateway"
        binding.statusText.text = if (GatewayService.isRunning) GatewayService.lastStatusText else "Stopped — tap Start Gateway to begin sending."
    }
}
