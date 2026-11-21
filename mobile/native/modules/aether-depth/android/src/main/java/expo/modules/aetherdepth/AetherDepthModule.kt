package expo.modules.aetherdepth

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import com.google.ar.core.ArCoreApk
import com.oney.WebRTCModule.AetherDepthStream
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class AetherDepthModule : Module() {
  private val streams = AetherDepthStream()
  private val ui = Handler(Looper.getMainLooper())
  private var canRequestInstall = true
  private val generation = AtomicLong()
  private var installer: Promise? = null
  private val installerTimeout = Runnable { takeInstaller()?.resolve(null) }

  private fun takeInstaller(): Promise? {
    val pending = installer
    installer = null
    ui.removeCallbacks(installerTimeout)
    return pending
  }

  private fun open(promise: Promise) {
    val context = appContext.reactContext as? ReactApplicationContext
    val activity = appContext.currentActivity
    val attempt = generation.incrementAndGet()
    if (context == null || activity == null || activity.isFinishing || activity.isDestroyed || installer != null) {
      promise.resolve(null)
      return
    }
    // The availability check may query Play Services on a first install. Keep the
    // ordinary camera usable offline if it takes too long.
    var waiting = true
    val timeout = Runnable {
      waiting = false
      promise.resolve(null)
    }
    ui.postDelayed(timeout, 2500)
    val ar = ArCoreApk.getInstance()
    ar.checkAvailabilityAsync(activity) { availability ->
      ui.post {
        if (!waiting) return@post
        waiting = false
        ui.removeCallbacks(timeout)
        if (!availability.isSupported || generation.get() != attempt || activity.isFinishing ||
            activity.isDestroyed || context.lifecycleState != LifecycleState.RESUMED) {
          promise.resolve(null)
          return@post
        }
        try {
          if (ar.requestInstall(activity, canRequestInstall) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
            canRequestInstall = false
            // Google's installer temporarily covers our activity. Keep the existing
            // request until foreground resumes; opening the fallback camera here
            // would race the installer and lose the first depth-capable session.
            installer = promise
            ui.postDelayed(installerTimeout, 60_000)
          } else streams.open(context) { info -> promise.resolve(info) }
        } catch (_: Exception) {
          promise.resolve(null)
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AetherDepth")

    AsyncFunction("open") { promise: Promise ->
      ui.post { open(promise) }
      Unit
    }
    Function("cancelOpen") {
      generation.incrementAndGet()
      ui.post { takeInstaller()?.resolve(null) }
      streams.cancelOpening()
    }

    Function("read") { streamId: String -> streams.read(streamId) }
    AsyncFunction("snapshot") { streamId: String, promise: Promise ->
      // WebRTC can dispose its EGL handler while a snapshot is queued. Bound the
      // promise independently of that handler, including during stream release.
      val completed = AtomicBoolean()
      val timeout = Runnable { if (completed.compareAndSet(false, true)) promise.resolve(null) }
      ui.postDelayed(timeout, 2000)
      streams.snapshot(streamId) { value ->
        if (completed.compareAndSet(false, true)) {
          ui.removeCallbacks(timeout)
          promise.resolve(value)
        }
      }
    }

    OnActivityEntersBackground { generation.incrementAndGet(); streams.release() }
    OnActivityEntersForeground { ui.post { takeInstaller()?.let(::open) }; Unit }
    OnDestroy {
      generation.incrementAndGet()
      ui.post { takeInstaller()?.resolve(null) }
      streams.release()
    }
  }
}
