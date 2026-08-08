package com.acc.companion

import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.util.Log

object FlashlightManager {
    private const val TAG = "ACC_Companion"
    private var cachedCameraId: String? = null
    private var isTorchOn: Boolean = false
    private var isCallbackRegistered: Boolean = false

    private fun getCameraIdWithFlash(cameraManager: CameraManager): String? {
        if (cachedCameraId != null) return cachedCameraId
        try {
            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                if (hasFlash && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cachedCameraId = id
                    Log.d(TAG, "Selected Camera ID with Flash: $id")
                    return id
                }
            }
            for (id in cameraManager.cameraIdList) {
                val hasFlash = cameraManager.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
                if (hasFlash) {
                    cachedCameraId = id
                    Log.d(TAG, "Fallback Camera ID selected: $id")
                    return id
                }
            }
        } catch (e: CameraAccessException) {
            Log.e(TAG, "Error enumerating cameras: ${e.message}", e)
        }
        return null
    }

    fun registerTorchCallbackIfNeeded(context: Context) {
        if (isCallbackRegistered) return
        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return
        try {
            cameraManager.registerTorchCallback(object : CameraManager.TorchCallback() {
                override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
                    if (cameraId == cachedCameraId || cachedCameraId == null) {
                        isTorchOn = enabled
                        Log.d(TAG, "Torch mode changed: enabled=$enabled for camera $cameraId")
                        sendStateBroadcast(context, enabled)
                    }
                }

                override fun onTorchModeUnavailable(cameraId: String) {
                    Log.w(TAG, "Torch mode unavailable for camera $cameraId")
                }
            }, null)
            isCallbackRegistered = true
        } catch (e: Exception) {
            Log.e(TAG, "Failed registering TorchCallback: ${e.message}", e)
        }
    }

    fun setTorchMode(context: Context, enabled: Boolean) {
        registerTorchCallbackIfNeeded(context)
        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        if (cameraManager == null) {
            Log.e(TAG, "CameraManager unavailable")
            sendStateBroadcast(context, false)
            return
        }

        val cameraId = getCameraIdWithFlash(cameraManager)
        if (cameraId == null) {
            Log.e(TAG, "No camera with flash available on device")
            sendStateBroadcast(context, false)
            return
        }

        try {
            cameraManager.setTorchMode(cameraId, enabled)
            isTorchOn = enabled
            Log.d(TAG, "CameraManager.setTorchMode successfully called: cameraId=$cameraId, enabled=$enabled")
            sendStateBroadcast(context, enabled)
        } catch (e: CameraAccessException) {
            Log.e(TAG, "CameraAccessException setting torch mode: ${e.message}", e)
            sendStateBroadcast(context, isTorchOn)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "IllegalArgumentException setting torch mode: ${e.message}", e)
            sendStateBroadcast(context, isTorchOn)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException setting torch mode (permission denied): ${e.message}", e)
            sendStateBroadcast(context, isTorchOn)
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error setting torch mode: ${e.message}", e)
            sendStateBroadcast(context, isTorchOn)
        }
    }

    fun toggleTorch(context: Context) {
        setTorchMode(context, !isTorchOn)
    }

    fun sendStateBroadcast(context: Context, state: Boolean = isTorchOn) {
        try {
            val intent = Intent("com.acc.FLASHLIGHT_RESPONSE").apply {
                putExtra("enabled", state)
            }
            context.sendBroadcast(intent)
            Log.d(TAG, "Broadcast sent: com.acc.FLASHLIGHT_RESPONSE with enabled=$state")
        } catch (e: Exception) {
            Log.e(TAG, "Failed sending state broadcast: ${e.message}", e)
        }
    }
}
