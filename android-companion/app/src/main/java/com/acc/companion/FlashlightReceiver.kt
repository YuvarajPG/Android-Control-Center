package com.acc.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class FlashlightReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        Log.d("ACC_Companion", "Received broadcast: action=$action")

        when (action) {
            "com.acc.FLASHLIGHT" -> {
                val enabled = intent.getBooleanExtra("enabled", false)
                Log.d("ACC_Companion", "Action com.acc.FLASHLIGHT: enabled=$enabled")
                FlashlightManager.setTorchMode(context, enabled)
            }
            "com.acc.FLASHLIGHT_TOGGLE" -> {
                Log.d("ACC_Companion", "Action com.acc.FLASHLIGHT_TOGGLE triggered")
                FlashlightManager.toggleTorch(context)
            }
            "com.acc.FLASHLIGHT_STATE" -> {
                Log.d("ACC_Companion", "Action com.acc.FLASHLIGHT_STATE requested")
                FlashlightManager.sendStateBroadcast(context)
            }
            else -> {
                Log.w("ACC_Companion", "Unknown action received: $action")
            }
        }
    }
}
