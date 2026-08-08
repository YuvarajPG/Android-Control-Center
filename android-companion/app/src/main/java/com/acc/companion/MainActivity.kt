package com.acc.companion

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val textView = TextView(this).apply {
            text = "Android Control Center Companion\n\nPackage: com.acc.companion\nStatus: CameraManager Flashlight Service Ready\n\nThis app communicates with desktop Android Control Center via official Android CameraManager APIs."
            textSize = 16f
            setPadding(48, 48, 48, 48)
        }
        setContentView(textView)
        FlashlightManager.registerTorchCallbackIfNeeded(applicationContext)
    }
}
